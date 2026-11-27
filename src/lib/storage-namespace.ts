/**
 * Storage namespaces for the duress (decoy) PIN: after unlocking with the
 * duress PIN, every wallet key ("raijin.nodes.v1", Cashu, contacts, ...) is
 * read and written under "raijin.decoy.…", a completely separate wallet.
 * Security keys and display preferences are shared, so the app looks and
 * locks the same in both modes.
 */
let decoy = false;

const SHARED = [/^raijin\.pin\./, /^raijin\.biometrics\./, /^raijin\.prefs\./, /^raijin\.theme\./];

const listeners = new Set<() => void>();

export function setDecoyNamespace(on: boolean): void {
  if (decoy === on) return;
  decoy = on;
  listeners.forEach((l) => l());
}

/** In-memory caches of stored data (Cashu seed, counters, wallets) must reset on a switch. */
export function onNamespaceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isDecoyNamespace(): boolean {
  return decoy;
}

export function mapKey(key: string): string {
  if (!decoy || SHARED.some((re) => re.test(key))) return key;
  return key.replace(/^raijin\./, 'raijin.decoy.');
}

/**
 * Bumped when stored data was replaced wholesale (backup restore), so the
 * wallet providers remount and read everything again.
 */
let epoch = 0;
const epochListeners = new Set<() => void>();

export function notifyStorageReplaced(): void {
  epoch += 1;
  listeners.forEach((l) => l()); // in-memory caches as on a namespace switch
  epochListeners.forEach((l) => l());
}

export function getStorageEpoch(): number {
  return epoch;
}

export function subscribeStorageEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => epochListeners.delete(listener);
}
