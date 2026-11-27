import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

import { textsFromNdef } from './nfc-ndef';

/**
 * Reading NFC tags: payment stickers, a merchant's phone showing an invoice,
 * and Bolt Cards (LNURL-withdraw). Only reading; Raijin never writes tags.
 */
export type NfcState = 'unsupported' | 'off' | 'ready';

let started: Promise<boolean> | null = null;

function start(): Promise<boolean> {
  started ??= NfcManager.isSupported()
    .then((supported) => (supported ? NfcManager.start().then(() => true) : false))
    .catch(() => false);
  return started;
}

export async function nfcState(): Promise<NfcState> {
  if (!(await start())) return 'unsupported';
  return (await NfcManager.isEnabled().catch(() => false)) ? 'ready' : 'off';
}

/** Android listens in the background of a screen; iOS needs a tap that opens the system sheet. */
export const nfcNeedsButton = Platform.OS === 'ios';

/**
 * Waits for one tag and returns its texts (empty if it had none).
 * Rejects when cancelled (`cancelNfcRead`) or on a read error.
 */
export async function readNfcTag(alertMessage: string): Promise<string[]> {
  if (!(await start())) throw new Error('NFC is not supported');
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage });
    const tag = await NfcManager.getTag();
    return textsFromNdef(tag?.ndefMessage);
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

export function cancelNfcRead(): void {
  NfcManager.cancelTechnologyRequest().catch(() => {});
}

export function openNfcSettings(): void {
  NfcManager.goToNfcSetting().catch(() => {});
}
