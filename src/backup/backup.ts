import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { getRandomBytes } from 'expo-crypto';

import * as SecureStore from '@/lib/secure-store';
import { notifyStorageReplaced } from '@/lib/storage-namespace';

/**
 * Encrypted backup of everything Raijin stores: node connections, Cashu
 * (seed, proofs, history), contacts, payment notes, preferences, theme.
 * Not included: the app PIN, the duress PIN, biometrics (device-bound).
 *
 * Format (JSON file): scrypt(password) → 32-byte key, XChaCha20-Poly1305
 * with a random 24-byte nonce. The header is authenticated as AAD, so
 * nobody can swap the KDF parameters without breaking the tag.
 */

const FORMAT = 'raijin-backup';
const VERSION = 1;
const KDF = { name: 'scrypt', N: 2 ** 15, r: 8, p: 1 } as const;
export const MIN_PASSWORD = 10;
export const SEED_CONFLICT =
  'This device already has other Cashu recovery words and ecash. Back them up and remove the mints before restoring.';

type Header = {
  format: typeof FORMAT;
  version: number;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'xchacha20poly1305';
  nonce: string;
  createdAt: string;
};

type BackupFile = Header & { data: string };

type Payload = { entries: Record<string, string>; app: string };

const STATIC_KEYS = [
  'raijin.nodes.v1',
  'raijin.prefs.v1',
  'raijin.theme.v2',
  'raijin.contacts.v1',
  'raijin.notes.v1',
  'raijin.cashu.mints.v1',
  'raijin.cashu.history.v1',
  'raijin.cashu.seed.v1',
  'raijin.cashu.seed.backedUp.v1',
  'raijin.cashu.counters.v1',
];

/** All keys that currently hold data worth backing up. */
async function collectEntries(): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  const read = async (key: string) => {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) entries[key] = value;
  };
  for (const key of STATIC_KEYS) await read(key);
  try {
    const index = JSON.parse(entries['raijin.nodes.v1'] ?? '{}') as { nodes?: { id: string }[] };
    for (const node of index.nodes ?? []) await read(`raijin.node.${node.id}.uri`);
  } catch {}
  try {
    const mints = JSON.parse(entries['raijin.cashu.mints.v1'] ?? '[]') as { id: string }[];
    for (const mint of mints) await read(`raijin.cashu.mint.${mint.id}.proofs`);
  } catch {}
  return entries;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function deriveKey(password: string, header: Header, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const { N, r, p, salt } = header.kdf;
  return scryptAsync(utf8ToBytes(password.normalize('NFKC')), hexToBytes(salt), {
    N,
    r,
    p,
    dkLen: 32,
    onProgress,
  });
}

const aad = (header: Header) => utf8ToBytes(JSON.stringify(header));

export async function createBackup(
  password: string,
  appVersion: string,
  onProgress?: (p: number) => void,
): Promise<{ json: string; entries: number }> {
  if (password.length < MIN_PASSWORD) throw new Error(`Password needs at least ${MIN_PASSWORD} characters.`);
  const entries = await collectEntries();
  const header: Header = {
    format: FORMAT,
    version: VERSION,
    kdf: { ...KDF, salt: bytesToHex(getRandomBytes(16)) },
    cipher: 'xchacha20poly1305',
    nonce: bytesToHex(getRandomBytes(24)),
    createdAt: new Date().toISOString(),
  };
  const key = await deriveKey(password, header, onProgress);
  const payload: Payload = { entries, app: appVersion };
  const sealed = xchacha20poly1305(key, hexToBytes(header.nonce), aad(header)).encrypt(
    utf8ToBytes(JSON.stringify(payload)),
  );
  const file: BackupFile = { ...header, data: toBase64(sealed) };
  return { json: JSON.stringify(file, null, 2), entries: Object.keys(entries).length };
}

export type BackupInfo = { createdAt: string; keys: string[]; nodes: number; mints: number; hasSeed: boolean };

/** Decrypts and checks a backup without writing anything. */
export async function openBackup(
  json: string,
  password: string,
  onProgress?: (p: number) => void,
): Promise<{ info: BackupInfo; entries: Record<string, string> }> {
  let file: BackupFile;
  try {
    file = JSON.parse(json) as BackupFile;
  } catch {
    throw new Error('This is not a Raijin backup file.');
  }
  if (file.format !== FORMAT || file.cipher !== 'xchacha20poly1305' || file.kdf?.name !== 'scrypt') {
    throw new Error('This is not a Raijin backup file.');
  }
  if (file.version > VERSION) throw new Error('This backup was made by a newer Raijin version.');
  const { data, ...header } = file;
  const key = await deriveKey(password, header, onProgress);
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, hexToBytes(header.nonce), aad(header)).decrypt(fromBase64(data));
  } catch {
    throw new Error('Wrong password or damaged file.');
  }
  const payload = JSON.parse(bytesToUtf8(plain)) as Payload;
  const keys = Object.keys(payload.entries).filter((k) => /^raijin\.[\w.-]+$/.test(k));
  const entries = Object.fromEntries(keys.map((k) => [k, payload.entries[k]]));
  const count = (key: string) => {
    try {
      const v = JSON.parse(entries[key] ?? 'null') as { nodes?: unknown[] } | unknown[] | null;
      return Array.isArray(v) ? v.length : (v?.nodes?.length ?? 0);
    } catch {
      return 0;
    }
  };
  return {
    info: {
      createdAt: header.createdAt,
      keys,
      nodes: count('raijin.nodes.v1'),
      mints: count('raijin.cashu.mints.v1'),
      hasSeed: 'raijin.cashu.seed.v1' in entries,
    },
    entries,
  };
}

/**
 * Writes the backup into the current storage (overwriting same keys) and
 * makes the app reload its state. Existing Cashu proofs of mints that are
 * in the backup are merged, not replaced, so no ecash is lost.
 */
export async function restoreBackup(entries: Record<string, string>): Promise<void> {
  // Check before writing anything: a different Cashu seed must not be overwritten.
  const seed = await SecureStore.getItemAsync('raijin.cashu.seed.v1');
  const incomingSeed = entries['raijin.cashu.seed.v1'];
  if (seed && incomingSeed && seed !== incomingSeed) {
    const mints = JSON.parse((await SecureStore.getItemAsync('raijin.cashu.mints.v1')) ?? '[]') as unknown[];
    if (mints.length > 0) throw new Error(SEED_CONFLICT);
  }
  for (const [key, value] of Object.entries(entries)) {
    const current = await SecureStore.getItemAsync(key);
    await SecureStore.setItemAsync(key, current ? merge(key, current, value) : value);
  }
  notifyStorageReplaced();
}

type WithId = { id: string };

function unionById<T extends WithId>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((x) => x.id));
  return [...current, ...incoming.filter((x) => !seen.has(x.id))];
}

/** Lists are merged (nothing on this device is dropped); single values from the backup win. */
function merge(key: string, current: string, incoming: string): string {
  try {
    if (/^raijin\.cashu\.mint\..+\.proofs$/.test(key)) {
      return JSON.stringify([...new Set([...(JSON.parse(current) as string[]), ...(JSON.parse(incoming) as string[])])]);
    }
    if (key === 'raijin.nodes.v1') {
      const a = JSON.parse(current) as { nodes: WithId[]; activeId: string | null };
      const b = JSON.parse(incoming) as { nodes: WithId[]; activeId: string | null };
      return JSON.stringify({ nodes: unionById(a.nodes ?? [], b.nodes ?? []), activeId: a.activeId ?? b.activeId });
    }
    if (key === 'raijin.cashu.mints.v1' || key === 'raijin.contacts.v1' || key === 'raijin.cashu.history.v1') {
      return JSON.stringify(unionById(JSON.parse(current) as WithId[], JSON.parse(incoming) as WithId[]));
    }
    if (key === 'raijin.notes.v1') {
      return JSON.stringify({ ...(JSON.parse(incoming) as object), ...(JSON.parse(current) as object) });
    }
    if (key === 'raijin.cashu.counters.v1') {
      // Never move a counter backwards: reused counters would collide at the mint.
      const a = JSON.parse(current) as Record<string, number>;
      const b = JSON.parse(incoming) as Record<string, number>;
      const out: Record<string, number> = { ...b };
      for (const [id, n] of Object.entries(a)) out[id] = Math.max(n, out[id] ?? 0);
      return JSON.stringify(out);
    }
    if (key === 'raijin.cashu.seed.v1' && current !== incoming) {
      // A different seed on this device keeps its ecash restorable only with its own words.
      return incoming; // checked in restoreBackup: no ecash depends on the old seed
    }
  } catch {
    // Unreadable current value: the backup wins.
  }
  return incoming;
}
