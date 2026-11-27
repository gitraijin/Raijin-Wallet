/**
 * Web / desktop variant of secure-store.ts.
 *
 * In the desktop app (Electron) the preload script exposes `raijinDesktop`;
 * values are encrypted with the OS keychain (Electron safeStorage: Keychain on
 * macOS, DPAPI on Windows, libsecret/kwallet on Linux) and stored in the app's
 * data folder. In a plain browser (`expo start --web`, development only) the
 * values fall back to localStorage, which is NOT secure.
 */
import { desktop } from './desktop';
import { mapKey } from './storage-namespace';

export type SecureStoreOptions = { keychainAccessible?: number };
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 0;

let warned = false;
function browserStorage(): Storage {
  if (!warned) {
    warned = true;
    console.warn('[secure-store] no desktop bridge: using localStorage (development only, not secure)');
  }
  return globalThis.localStorage;
}

export async function getItemAsync(rawKey: string, _options?: SecureStoreOptions): Promise<string | null> {
  const key = mapKey(rawKey);
  if (desktop) return desktop.secureGet(key);
  return browserStorage().getItem(key);
}

export async function setItemAsync(rawKey: string, value: string, _options?: SecureStoreOptions): Promise<void> {
  const key = mapKey(rawKey);
  if (desktop) return desktop.secureSet(key, value);
  browserStorage().setItem(key, value);
}

export async function deleteItemAsync(rawKey: string, _options?: SecureStoreOptions): Promise<void> {
  const key = mapKey(rawKey);
  if (desktop) return desktop.secureDelete(key);
  browserStorage().removeItem(key);
}
