import { useEffect } from 'react';
import { AppState } from 'react-native';

import { onPaymentReceived } from '@/motion/payments';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { useWallet } from '@/wallet/WalletContext';

import { setBackgroundChecks } from './background';
import { showNotification } from './index';
import { saveSeen } from './seen';

function inBackground(): boolean {
  if (AppState.currentState !== 'active') return true;
  // Desktop: the window is open but not in front.
  const doc = (globalThis as { document?: { hidden?: boolean; hasFocus?: () => boolean } }).document;
  return doc ? Boolean(doc.hidden) || doc.hasFocus?.() === false : false;
}

/**
 * Connects payment events with system notifications: shown only when the
 * app is not in front (in front, the toast is enough). Keeps the background
 * check registered while notifications are on, and hands it the payments the
 * user has already seen.
 */
export function NotificationBridge() {
  const { notifications, t } = usePreferences();
  const amount = useAmount();
  const { payments, activeNodeId } = useWallet();

  useEffect(() => {
    if (!notifications) return;
    return onPaymentReceived((payment) => {
      if (!inBackground()) return;
      void showNotification(
        t('notify.title'),
        t('notify.body', { amount: amount.format(payment.amountSats) }) +
          (payment.description ? ` // ${payment.description}` : ''),
      ).catch(() => {});
    });
  }, [notifications, t, amount]);

  useEffect(() => {
    setBackgroundChecks(notifications).catch((error) => console.warn('[notify] background task', error));
  }, [notifications]);

  // When the app leaves the foreground, everything on screen counts as seen.
  useEffect(() => {
    if (!activeNodeId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      const ids = payments.filter((p) => p.direction === 'in' && p.state === 'complete').map((p) => p.id);
      void saveSeen(activeNodeId, ids).catch(() => {});
    });
    return () => subscription.remove();
  }, [payments, activeNodeId]);

  return null;
}
