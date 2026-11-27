import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto';
import * as SecureStore from '@/lib/secure-store';

/**
 * App PIN. Only a salted SHA-256 hash is stored, in the platform keystore
 * (never in backups). A 6-digit PIN has just 10^6 combinations, so the real
 * protection is the keystore plus the escalating lockout below, not the hash.
 */
export const PIN_LENGTH = 6;

const PIN_KEY = 'raijin.pin.v1';
const ATTEMPTS_KEY = 'raijin.pin.attempts.v1';
const BIOMETRICS_KEY = 'raijin.biometrics.v1';
/** Second PIN that opens the decoy wallet (storage-namespace.ts). */
const DURESS_KEY = 'raijin.pin.duress.v1';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Free attempts before lockouts start; each further failure doubles the wait. */
const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 60 * 60_000;

type StoredPin = { salt: string; hash: string };
type Attempts = { failures: number; lockedUntil: number };

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const hashPin = (salt: string, pin: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, `raijin-pin:${salt}:${pin}`);

/** Compares without an early exit, so timing does not leak the matching prefix. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY, STORE_OPTIONS)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error(`PIN must be ${PIN_LENGTH} digits`);
  const duressRaw = await SecureStore.getItemAsync(DURESS_KEY, STORE_OPTIONS);
  if (duressRaw) {
    const duress = JSON.parse(duressRaw) as StoredPin;
    if (equalConstantTime(await hashPin(duress.salt, pin), duress.hash)) {
      throw new Error('The app PIN must differ from the duress PIN.');
    }
  }
  const salt = toHex(getRandomBytes(16));
  const stored: StoredPin = { salt, hash: await hashPin(salt, pin) };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(stored), STORE_OPTIONS);
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY, STORE_OPTIONS);
}

async function readAttempts(): Promise<Attempts> {
  const raw = await SecureStore.getItemAsync(ATTEMPTS_KEY, STORE_OPTIONS);
  if (!raw) return { failures: 0, lockedUntil: 0 };
  try {
    return JSON.parse(raw) as Attempts;
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

/** Milliseconds until the next attempt is allowed (0 = now). */
export async function lockoutRemainingMs(): Promise<number> {
  const { lockedUntil } = await readAttempts();
  return Math.max(0, lockedUntil - Date.now());
}

export type VerifyResult = { ok: true; duress: boolean } | { ok: false; lockedForMs: number; failures: number };

export async function verifyPin(pin: string): Promise<VerifyResult> {
  const attempts = await readAttempts();
  const waitMs = attempts.lockedUntil - Date.now();
  if (waitMs > 0) return { ok: false, lockedForMs: waitMs, failures: attempts.failures };

  const raw = await SecureStore.getItemAsync(PIN_KEY, STORE_OPTIONS);
  if (!raw) return { ok: true, duress: false }; // no PIN set: nothing to protect yet
  const stored = JSON.parse(raw) as StoredPin;
  const duressRaw = await SecureStore.getItemAsync(DURESS_KEY, STORE_OPTIONS);
  const duress = duressRaw ? (JSON.parse(duressRaw) as StoredPin) : null;

  // Both hashes are always computed, so timing does not tell which PIN matched.
  const realMatch = equalConstantTime(await hashPin(stored.salt, pin), stored.hash);
  const duressMatch = duress ? equalConstantTime(await hashPin(duress.salt, pin), duress.hash) : false;
  if (realMatch || duressMatch) {
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY, STORE_OPTIONS);
    return { ok: true, duress: !realMatch && duressMatch };
  }

  const failures = attempts.failures + 1;
  const over = failures - FREE_ATTEMPTS;
  const lockedForMs = over > 0 ? Math.min(BASE_LOCKOUT_MS * 2 ** (over - 1), MAX_LOCKOUT_MS) : 0;
  const next: Attempts = { failures, lockedUntil: lockedForMs ? Date.now() + lockedForMs : 0 };
  await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify(next), STORE_OPTIONS);
  return { ok: false, lockedForMs, failures };
}

export async function hasDuressPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(DURESS_KEY, STORE_OPTIONS)) !== null;
}

/** Sets the duress PIN; it must differ from the app PIN. */
export async function setDuressPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error(`PIN must be ${PIN_LENGTH} digits`);
  const raw = await SecureStore.getItemAsync(PIN_KEY, STORE_OPTIONS);
  if (raw) {
    const stored = JSON.parse(raw) as StoredPin;
    if (equalConstantTime(await hashPin(stored.salt, pin), stored.hash)) {
      throw new Error('The duress PIN must differ from the app PIN.');
    }
  }
  const salt = toHex(getRandomBytes(16));
  await SecureStore.setItemAsync(DURESS_KEY, JSON.stringify({ salt, hash: await hashPin(salt, pin) }), STORE_OPTIONS);
}

export async function clearDuressPin(): Promise<void> {
  await SecureStore.deleteItemAsync(DURESS_KEY, STORE_OPTIONS);
}

export async function isBiometricsEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRICS_KEY, STORE_OPTIONS)) === '1';
}

export async function setBiometricsEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(BIOMETRICS_KEY, '1', STORE_OPTIONS);
  else await SecureStore.deleteItemAsync(BIOMETRICS_KEY, STORE_OPTIONS);
}

/** Removes PIN, attempt counter and biometrics flag (used when the wallet is deleted). */
export async function clearSecurity(): Promise<void> {
  await Promise.all(
    [PIN_KEY, ATTEMPTS_KEY, BIOMETRICS_KEY, DURESS_KEY].map((key) => SecureStore.deleteItemAsync(key, STORE_OPTIONS)),
  );
}
