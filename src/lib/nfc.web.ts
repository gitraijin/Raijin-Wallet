// Desktop and web: no NFC reader.
export type NfcState = 'unsupported' | 'off' | 'ready';

export async function nfcState(): Promise<NfcState> {
  return 'unsupported';
}

export const nfcNeedsButton = false;

export async function readNfcTag(): Promise<string[]> {
  throw new Error('NFC is not supported');
}

export function cancelNfcRead(): void {}

export function openNfcSettings(): void {}
