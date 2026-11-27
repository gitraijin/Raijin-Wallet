import { useSyncExternalStore } from 'react';

import { RaijinTor, type TorStatus } from '../../modules/raijin-tor';

export type { TorStatus } from '../../modules/raijin-tor';

/** Embedded Tor is Android-only for now. */
export const torAvailable = RaijinTor !== null;

const OFF: TorStatus = { state: 'off', progress: 0, socksPort: 0, error: null };

let status: TorStatus = RaijinTor?.getStatus() ?? OFF;
const listeners = new Set<() => void>();

RaijinTor?.addListener('onStatus', (next) => {
  status = next;
  listeners.forEach((l) => l());
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTorStatus(): TorStatus {
  return status;
}

/** Live Tor status for screens. */
export function useTorStatus(): TorStatus {
  return useSyncExternalStore(subscribe, getTorStatus, getTorStatus);
}

/** Starts Tor (no-op if running). Requests over Tor start it on demand anyway. */
export async function startTor(): Promise<void> {
  if (!RaijinTor) throw new Error('Tor is not available on this device.');
  await RaijinTor.start();
}

export function stopTor(): void {
  RaijinTor?.stop();
}
