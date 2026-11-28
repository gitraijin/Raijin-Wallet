import { type CounterRange, type CounterSource, mnemonicToSeedSync } from '@cashu/cashu-ts';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import * as SecureStore from '@/lib/secure-store';
import { onNamespaceChange } from '@/lib/storage-namespace';

/**
 * Cashu seed (NUT-13): 12 BIP-39 words from which all ecash secrets are
 * derived, so the ecash can be restored from the mints (NUT-09) after losing
 * the device. Separate from any node: Raijin still holds no node keys.
 *
 * Counters (one per keyset) say which derivation index comes next. They must
 * never be reused, so every reservation is written to the store before the
 * secrets are used.
 */

const SEED_KEY = 'raijin.cashu.seed.v1';
const BACKUP_KEY = 'raijin.cashu.seed.backedUp.v1';
const COUNTERS_KEY = 'raijin.cashu.counters.v1';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let cachedSeed: { words: string; bytes: Uint8Array } | null = null;

export function normalizeWords(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidMnemonic(words: string): boolean {
  return validateMnemonic(normalizeWords(words), wordlist);
}

export async function loadMnemonic(): Promise<string | null> {
  return SecureStore.getItemAsync(SEED_KEY, OPTIONS);
}

/** The seed bytes, creating a new 12-word seed on first use. */
export async function seedBytes(): Promise<Uint8Array> {
  let words = await loadMnemonic();
  if (!words) {
    words = generateMnemonic(wordlist, 128);
    await SecureStore.setItemAsync(SEED_KEY, words, OPTIONS);
    await SecureStore.deleteItemAsync(BACKUP_KEY, OPTIONS);
  }
  if (cachedSeed?.words !== words) cachedSeed = { words, bytes: mnemonicToSeedSync(words) };
  return cachedSeed.bytes;
}

/** Replaces the seed (restore). Existing proofs stay: they are bearer tokens. */
export async function replaceMnemonic(words: string): Promise<void> {
  const normalized = normalizeWords(words);
  if (!validateMnemonic(normalized, wordlist)) throw new Error('Invalid recovery words.');
  await SecureStore.setItemAsync(SEED_KEY, normalized, OPTIONS);
  await SecureStore.setItemAsync(BACKUP_KEY, '1', OPTIONS);
  // Counters belong to a seed; a restore moves them forward again.
  counters.clear();
  await SecureStore.deleteItemAsync(COUNTERS_KEY, OPTIONS);
  // The on-chain wallet's address counts belong to the old words too.
  await SecureStore.deleteItemAsync('raijin.onchain.state.v1');
  cachedSeed = null;
}

export async function isBackedUp(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BACKUP_KEY, OPTIONS)) === '1';
}

export async function markBackedUp(): Promise<void> {
  await SecureStore.setItemAsync(BACKUP_KEY, '1', OPTIONS);
}

/* ------------------------------------------------------------------ */
/* Persistent counters                                                 */
/* ------------------------------------------------------------------ */

class StoredCounterSource implements CounterSource {
  private next = new Map<string, number>();
  private loaded: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await SecureStore.getItemAsync(COUNTERS_KEY, OPTIONS);
        const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
        for (const [id, n] of Object.entries(data)) if (Number.isInteger(n)) this.next.set(id, n);
      } catch {
        // Unreadable counters: start at 0; reserveAt/restore protect against reuse.
      }
    })();
    return this.loaded;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(Object.fromEntries(this.next));
    this.writing = this.writing.then(() => SecureStore.setItemAsync(COUNTERS_KEY, snapshot, OPTIONS));
    return this.writing;
  }

  clear(): void {
    this.next.clear();
    this.loaded = Promise.resolve();
  }

  /** Forget everything in memory; the next use reads the store again. */
  unload(): void {
    this.next.clear();
    this.loaded = null;
  }

  async reserve(keysetId: string, n: number): Promise<CounterRange> {
    await this.load();
    // Read and bump synchronously, so two reservations never overlap.
    const start = this.next.get(keysetId) ?? 0;
    this.next.set(keysetId, start + n);
    await this.persist();
    return { start, count: n };
  }

  async reserveAt(keysetId: string, start: number, count: number): Promise<CounterRange> {
    await this.load();
    const current = this.next.get(keysetId) ?? 0;
    if (start < current) throw new Error(`Counter ${start} for keyset ${keysetId} was already used`);
    this.next.set(keysetId, start + count);
    await this.persist();
    return { start, count };
  }

  async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
    await this.load();
    if ((this.next.get(keysetId) ?? 0) >= minNext) return;
    this.next.set(keysetId, minNext);
    await this.persist();
  }

  async setNext(keysetId: string, next: number): Promise<void> {
    await this.load();
    this.next.set(keysetId, next);
    await this.persist();
  }

  async snapshot(): Promise<Record<string, number>> {
    await this.load();
    return Object.fromEntries(this.next);
  }
}

/** One counter source shared by all wallet instances (see cashu-ts docs). */
export const counters = new StoredCounterSource();

// Duress PIN: the decoy wallet has its own seed and counters.
onNamespaceChange(() => {
  cachedSeed = null;
  counters.unload();
});
