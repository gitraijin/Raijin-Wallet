import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { loadNodeIndex, loadNodeUri } from '@/lib/nodes';
import * as SecureStore from '@/lib/secure-store';
import { setTorForAll } from '@/lightning/http';

import { BalanceWidget } from './BalanceWidget';
import { loadWidgetData, loadWidgetLook, saveWidgetData, type WidgetData } from './data';

const FETCH_TIMEOUT_MS = 20_000;

/** Fresh balance from the active node; null if it cannot be reached in time. */
async function fetchFresh(): Promise<WidgetData | null> {
  const index = await loadNodeIndex();
  const node = index.nodes.find((n) => n.id === index.activeId);
  if (!node) return null;
  const uri = await loadNodeUri(node.id);
  if (!uri) return null;
  const prefs = JSON.parse((await SecureStore.getItemAsync('raijin.prefs.v1')) ?? '{}') as { torAll?: boolean };
  setTorForAll(prefs.torAll === true);
  const { openBackend } = await import('@/lightning');
  const work = (async () => {
    const backend = await openBackend(uri);
    try {
      const snapshot = await backend.getSnapshot();
      return {
        nodeName: node.name,
        balanceSats: snapshot.balanceSats.toString(),
        lightningSats: snapshot.breakdown?.lightningSats.toString() ?? null,
        onchainSats: snapshot.breakdown?.onchainSats.toString() ?? null,
        updatedAt: Date.now(),
      } satisfies WidgetData;
    } finally {
      await backend.disconnect().catch(() => {});
    }
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
  return Promise.race([work, timeout]);
}

/** Runs headless when the launcher adds, updates or resizes the widget. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
  const look = await loadWidgetLook();
  const cached = await loadWidgetData();
  // Draw the cached state at once, then try to refresh.
  props.renderWidget(<BalanceWidget data={cached} {...look} />);
  if (props.widgetAction !== 'WIDGET_UPDATE' && cached) return;
  try {
    const fresh = await fetchFresh();
    if (fresh) {
      await saveWidgetData(fresh);
      props.renderWidget(<BalanceWidget data={fresh} {...look} />);
    }
  } catch (error) {
    console.warn('[widget] refresh failed', error);
  }
}
