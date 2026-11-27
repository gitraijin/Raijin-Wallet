/**
 * Secure key/value storage. On Android and iOS this is the platform keystore
 * (expo-secure-store); the desktop app has its own implementation in
 * secure-store.web.ts. Same names as expo-secure-store, so callers only
 * change the import. Keys pass through the duress namespace (storage-namespace.ts).
 */
import * as Native from 'expo-secure-store';

import { mapKey } from './storage-namespace';

export type SecureStoreOptions = Native.SecureStoreOptions;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = Native.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

export function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  return Native.getItemAsync(mapKey(key), options);
}

export function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  return Native.setItemAsync(mapKey(key), value, options);
}

export function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  return Native.deleteItemAsync(mapKey(key), options);
}
