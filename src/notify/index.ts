import { RaijinNotify } from '../../modules/raijin-notify';

/**
 * Local notifications on Android (no push server involved). Our own small
 * native module instead of expo-notifications, which always ships Firebase
 * Cloud Messaging and Google Play services code even when push is off.
 */

const CHANNEL = 'payments';

let channelReady = false;
function ensureChannel(): void {
  if (channelReady || !RaijinNotify) return;
  RaijinNotify.setChannel(CHANNEL, 'Payments', '#9B4DFF', [0, 120, 80, 120]);
  channelReady = true;
}

/** Asks for permission if needed. Resolves true when notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!RaijinNotify) return false;
  ensureChannel();
  const current = await RaijinNotify.getPermission();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await RaijinNotify.requestPermission()).granted;
}

export async function showNotification(title: string, body: string): Promise<void> {
  if (!RaijinNotify) return;
  ensureChannel();
  // The native side checks the permission and drops the message without it.
  RaijinNotify.show(CHANNEL, title, body);
}

export const backgroundChecksAvailable = true;
