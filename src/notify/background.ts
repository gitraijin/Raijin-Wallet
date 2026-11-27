import * as BackgroundTask from 'expo-background-task';
import { getLocales } from 'expo-localization';
import * as TaskManager from 'expo-task-manager';

import { isLang, resolveLang, translator } from '@/i18n';
import { formatSats } from '@/lib/format';
import { loadNodeIndex, loadNodeUri } from '@/lib/nodes';
import * as SecureStore from '@/lib/secure-store';
import { setTorForAll } from '@/lightning/http';

import { showNotification } from './index';
import { loadSeen, saveSeen } from './seen';

/**
 * Periodic payment check while the app is closed (Android WorkManager / iOS
 * BGTaskScheduler, at most every ~15 minutes, when the system allows it).
 * Connects to the active node, compares incoming payments with the ones
 * already seen and shows a notification for new ones.
 *
 * Must be imported at module scope (app/_layout.tsx) so the task is defined
 * when the system wakes the app headless.
 */
export const PAYMENT_CHECK_TASK = 'raijin-payment-check';

const PREFS_KEY = 'raijin.prefs.v1';

TaskManager.defineTask(PAYMENT_CHECK_TASK, async () => {
  try {
    const prefs = JSON.parse((await SecureStore.getItemAsync(PREFS_KEY)) ?? '{}') as {
      language?: string;
      notifications?: boolean;
      torAll?: boolean;
    };
    if (prefs.notifications === false) return BackgroundTask.BackgroundTaskResult.Success;
    setTorForAll(prefs.torAll === true);

    const index = await loadNodeIndex();
    if (!index.activeId) return BackgroundTask.BackgroundTaskResult.Success;
    const uri = await loadNodeUri(index.activeId);
    if (!uri) return BackgroundTask.BackgroundTaskResult.Success;

    const { openBackend } = await import('@/lightning');
    const backend = await openBackend(uri);
    try {
      const snapshot = await backend.getSnapshot();
      const received = snapshot.payments.filter((p) => p.direction === 'in' && p.state === 'complete');
      const seen = await loadSeen(index.activeId);
      if (seen) {
        const fresh = received.filter((p) => !seen.has(p.id));
        const lang = resolveLang(
          prefs.language === 'auto' || isLang(prefs.language) ? prefs.language : 'auto',
          getLocales()[0]?.languageCode ?? null,
        );
        const t = translator(lang);
        for (const payment of fresh) {
          await showNotification(
            t('notify.title'),
            t('notify.body', { amount: `${formatSats(payment.amountSats)} sat` }) +
              (payment.description ? ` // ${payment.description}` : ''),
          );
        }
      }
      await saveSeen(index.activeId, received.map((p) => p.id));
    } finally {
      await backend.disconnect().catch(() => {});
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn('[notify] background check failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setBackgroundChecks(enabled: boolean): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(PAYMENT_CHECK_TASK);
  if (enabled && !registered) {
    await BackgroundTask.registerTaskAsync(PAYMENT_CHECK_TASK, { minimumInterval: 15 });
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(PAYMENT_CHECK_TASK);
  }
}
