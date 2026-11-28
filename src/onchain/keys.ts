/**
 * Which keys an on-chain wallet uses. Its connection string says it, without
 * holding anything secret:
 *
 *   raijin-onchain://bip84           shared words (Cashu), account 0 (first version)
 *   raijin-onchain://shared/<n>      shared words, BIP84 account n
 *   raijin-onchain://own/<id>        its own words (12 or 24) and optional
 *                                    passphrase, only for Bitcoin, never Cashu
 *
 * Own words and passphrase live in secure storage under the wallet's id and
 * are deleted with the wallet.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { normalizeWords, seedBytes } from '@/cashu/seed';
import * as SecureStore from '@/lib/secure-store';

export type OnchainKeys = { kind: 'shared'; account: number } | { kind: 'own'; id: string };

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const wordsKey = (id: string) => `raijin.onchain.own.${id}.words`;
const passKey = (id: string) => `raijin.onchain.own.${id}.passphrase`;
const backupKey = (id: string) => `raijin.onchain.own.${id}.backedUp`;

export function parseOnchainUri(uri: string): OnchainKeys {
  const rest = uri.trim().replace(/^raijin-onchain:\/\//i, '');
  if (rest === 'bip84') return { kind: 'shared', account: 0 };
  const shared = /^shared\/(\d{1,4})$/.exec(rest);
  if (shared) return { kind: 'shared', account: Number(shared[1]) };
  const own = /^own\/([a-z0-9]{6,40})$/.exec(rest);
  if (own) return { kind: 'own', id: own[1] };
  throw new Error('Unknown on-chain wallet');
}

export const sharedUri = (account: number) => (account === 0 ? 'raijin-onchain://bip84' : `raijin-onchain://shared/${account}`);
export const ownUri = (id: string) => `raijin-onchain://own/${id}`;

/** Key used for the wallet's small saved state (address counts). */
export function stateKey(keys: OnchainKeys): string {
  if (keys.kind === 'shared') return keys.account === 0 ? 'raijin.onchain.state.v1' : `raijin.onchain.state.shared${keys.account}`;
  return `raijin.onchain.state.own.${keys.id}`;
}

/** BIP39 seed bytes and BIP84 account for these keys. */
export async function loadSeed(keys: OnchainKeys): Promise<{ seed: Uint8Array; account: number }> {
  if (keys.kind === 'shared') return { seed: await seedBytes(), account: keys.account };
  const words = await SecureStore.getItemAsync(wordsKey(keys.id), OPTIONS);
  if (!words) throw new Error('The recovery words of this wallet are missing on this device.');
  const passphrase = (await SecureStore.getItemAsync(passKey(keys.id), OPTIONS)) ?? '';
  return { seed: mnemonicToSeedSync(words, passphrase), account: 0 };
}

export function newWords(count: 12 | 24): string {
  return generateMnemonic(wordlist, count === 24 ? 256 : 128);
}

export function validWords(words: string): boolean {
  return validateMnemonic(normalizeWords(words), wordlist);
}

/** Stores own words (+ passphrase) for a new wallet; returns its id. */
export async function createOwn(words: string, passphrase: string, restored: boolean): Promise<string> {
  const normalized = normalizeWords(words);
  if (!validateMnemonic(normalized, wordlist)) throw new Error('Invalid recovery words.');
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await SecureStore.setItemAsync(wordsKey(id), normalized, OPTIONS);
  // The passphrase is kept as typed (BIP39: case and spaces matter).
  if (passphrase) await SecureStore.setItemAsync(passKey(id), passphrase, OPTIONS);
  if (restored) await SecureStore.setItemAsync(backupKey(id), '1', OPTIONS);
  return id;
}

export async function ownWords(id: string): Promise<{ words: string; hasPassphrase: boolean } | null> {
  const words = await SecureStore.getItemAsync(wordsKey(id), OPTIONS);
  if (!words) return null;
  return { words, hasPassphrase: !!(await SecureStore.getItemAsync(passKey(id), OPTIONS)) };
}

export async function isOwnBackedUp(id: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(backupKey(id), OPTIONS)) === '1';
}

export async function markOwnBackedUp(id: string): Promise<void> {
  await SecureStore.setItemAsync(backupKey(id), '1', OPTIONS);
}

/** Removes an own wallet's words, passphrase and state (when the wallet is deleted). */
export async function forgetOwn(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(wordsKey(id), OPTIONS);
  await SecureStore.deleteItemAsync(passKey(id), OPTIONS);
  await SecureStore.deleteItemAsync(backupKey(id), OPTIONS);
  await SecureStore.deleteItemAsync(stateKey({ kind: 'own', id }));
}
