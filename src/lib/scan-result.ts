import { router } from 'expo-router';

/**
 * Scanning into a field: the screen calls `scanInto()`, the scanner opens in
 * "return" mode and hands the text back instead of navigating on.
 */
let pending: ((value: string | null) => void) | null = null;

export function scanInto(): Promise<string | null> {
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
    router.push({ pathname: '/scan', params: { mode: 'return' } });
  });
}

/** Called by the scanner. Returns false if nobody is waiting. */
export function deliverScan(value: string | null): boolean {
  const resolve = pending;
  pending = null;
  if (!resolve) return false;
  resolve(value);
  return true;
}
