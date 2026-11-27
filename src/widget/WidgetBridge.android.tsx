import { useEffect } from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';

import { usePreferences } from '@/preferences/PreferencesContext';
import { useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

import { BalanceWidget } from './BalanceWidget';
import { saveWidgetData, type WidgetData } from './data';

/** Keeps the home-screen widget in step with the app (balance, theme, hidden). */
export function WidgetBridge() {
  const { balanceSats, breakdown, lastSyncedAt, activeNode, status } = useWallet();
  const { hidden, unit } = usePreferences();
  const { colors } = useTheme();

  useEffect(() => {
    if (status !== 'ready' || !lastSyncedAt || !activeNode) return;
    const data: WidgetData = {
      nodeName: activeNode.name,
      balanceSats: balanceSats.toString(),
      lightningSats: breakdown?.lightningSats.toString() ?? null,
      onchainSats: breakdown?.onchainSats.toString() ?? null,
      updatedAt: lastSyncedAt.getTime(),
    };
    saveWidgetData(data).catch(() => {});
    requestWidgetUpdate({
      widgetName: 'Balance',
      renderWidget: () => <BalanceWidget data={data} colors={colors} hidden={hidden} unit={unit} />,
      widgetNotFound: () => {},
    }).catch(() => {});
  }, [status, balanceSats, breakdown, lastSyncedAt, activeNode, hidden, unit, colors]);

  return null;
}
