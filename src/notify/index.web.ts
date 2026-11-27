import { desktop } from '@/lib/desktop';

/** Desktop: native notifications through Electron; browser: Notification API. */

export async function ensureNotificationPermission(): Promise<boolean> {
  if (desktop) return true;
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export async function showNotification(title: string, body: string): Promise<void> {
  if (desktop) return desktop.notify(title, body);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export const backgroundChecksAvailable = false;
