import { deserializeProofs, type Proof, serializeProofs } from '@cashu/cashu-ts';
import { getRandomBytes } from 'expo-crypto';

import * as SecureStore from '@/lib/secure-store';

/**
 * Persistent Cashu state. Ecash proofs are bearer money (whoever has the
 * string can spend it), so everything lives in the secure store like the node
 * connection strings: a small mint list, one proof list per mint and the
 * history (which also holds pending mint quotes and sent tokens until they
 * are claimed).
 */

export type CashuMint = {
  id: string;
  /** Normalized mint URL (normalizeMintUrl). */
  url: string;
  name: string;
  addedAt: number;
};

export type CashuEntryKind = 'mint' | 'melt' | 'send' | 'receive';
/** reclaimed: a sent token that was taken back before the receiver claimed it. */
export type CashuEntryState = 'pending' | 'complete' | 'failed' | 'reclaimed';

export type CashuEntry = {
  id: string;
  mintId: string;
  kind: CashuEntryKind;
  state: CashuEntryState;
  /** Sats; decimal string so the list stays JSON. */
  amount: string;
  fee: string;
  /** Unix seconds. */
  timestamp: number;
  /** send: the token, kept until the receiver claimed it (or it was reclaimed). */
  token?: string;
  /** mint: the mint quote id and the invoice to pay. */
  quote?: string;
  invoice?: string;
  /** mint: quote expiry, unix seconds. */
  expiry?: number | null;
  memo?: string;
};

const MINTS_KEY = 'raijin.cashu.mints.v1';
const HISTORY_KEY = 'raijin.cashu.history.v1';
const proofsKey = (mintId: string) => `raijin.cashu.mint.${mintId}.proofs`;

/** Completed entries beyond this are dropped; pending ones are always kept. */
const HISTORY_LIMIT = 200;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function newId(): string {
  return Array.from(getRandomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await SecureStore.getItemAsync(key, OPTIONS);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Mints                                                               */
/* ------------------------------------------------------------------ */

export async function loadMints(): Promise<CashuMint[]> {
  const mints = await readJson<CashuMint[]>(MINTS_KEY, []);
  return Array.isArray(mints) ? mints : [];
}

export async function saveMints(mints: CashuMint[]): Promise<void> {
  await SecureStore.setItemAsync(MINTS_KEY, JSON.stringify(mints), OPTIONS);
}

/* ------------------------------------------------------------------ */
/* Proofs                                                              */
/* ------------------------------------------------------------------ */

export async function loadProofs(mintId: string): Promise<Proof[]> {
  const raw = await SecureStore.getItemAsync(proofsKey(mintId), OPTIONS);
  if (!raw) return [];
  try {
    return deserializeProofs(JSON.parse(raw) as string[]);
  } catch (error) {
    // Never silently treat unreadable money as zero: surface it.
    throw new Error(`Stored ecash for this mint is unreadable: ${String(error)}`);
  }
}

export async function saveProofs(mintId: string, proofs: Proof[]): Promise<void> {
  if (proofs.length === 0) {
    await SecureStore.deleteItemAsync(proofsKey(mintId), OPTIONS);
    return;
  }
  await SecureStore.setItemAsync(proofsKey(mintId), JSON.stringify(serializeProofs(proofs)), OPTIONS);
}

/** Merges new proofs into the stored ones (deduplicated by secret). */
export async function addProofs(mintId: string, incoming: Proof[]): Promise<void> {
  if (incoming.length === 0) return;
  const current = await loadProofs(mintId);
  const seen = new Set(current.map((p) => p.secret));
  await saveProofs(mintId, [...current, ...incoming.filter((p) => !seen.has(p.secret))]);
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export async function loadHistory(): Promise<CashuEntry[]> {
  const entries = await readJson<CashuEntry[]>(HISTORY_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

async function saveHistory(entries: CashuEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  let done = 0;
  const kept = sorted.filter((e) => e.state === 'pending' || ++done <= HISTORY_LIMIT);
  await SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(kept), OPTIONS);
}

export async function addEntry(entry: Omit<CashuEntry, 'id' | 'timestamp'>): Promise<CashuEntry> {
  const full: CashuEntry = { ...entry, id: newId(), timestamp: Math.floor(Date.now() / 1000) };
  await saveHistory([full, ...(await loadHistory())]);
  return full;
}

export async function updateEntry(id: string, patch: Partial<CashuEntry>): Promise<void> {
  const entries = await loadHistory();
  await saveHistory(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export async function removeMintData(mintId: string): Promise<void> {
  await SecureStore.deleteItemAsync(proofsKey(mintId), OPTIONS);
  const entries = await loadHistory();
  await saveHistory(entries.filter((e) => e.mintId !== mintId));
}
