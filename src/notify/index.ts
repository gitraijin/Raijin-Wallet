import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Local notifications on Android / iOS (no push server involved). */

const CHANNEL = 'payments';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let channelReady: Promise<unknown> | null = null;
function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Payments',
    // eslint-disable-next-line import/namespace -- re-exported enum the resolver misses
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 120, 80, 120],
    lightColor: '#9B4DFF',
  });
  return channelReady;
}

/** Asks for permission if needed. Resolves true when notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function showNotification(title: string, body: string): Promise<void> {
  await ensureChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    // Immediate; on Android in the payments channel.
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

export const backgroundChecksAvailable = true;
