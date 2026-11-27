import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { requestJson } from '@/lightning/http';

import { MEMPOOL_CURRENCIES, usePreferences } from './PreferencesContext';

const REFRESH_MS = 5 * 60_000;
const MEMPOOL_PRICES_URL = 'https://mempool.space/api/v1/prices';
const BLOCKCHAIN_TICKER_URL = 'https://blockchain.info/ticker';

export type PriceSource = 'mempool.space' | 'blockchain.info';

type PriceState = {
  /** Price of 1 BTC per currency code, e.g. { EUR: 61234.5 }. */
  rates: Record<string, number> | null;
  source: PriceSource | null;
  updatedAt: Date | null;
};

const PriceContext = createContext<PriceState>({ rates: null, source: null, updatedAt: null });

async function fetchMempool(): Promise<Record<string, number>> {
  const data = await requestJson<Record<string, number>>(MEMPOOL_PRICES_URL);
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(data)) {
    if (code !== 'time' && typeof value === 'number' && value > 0) rates[code] = value;
  }
  return rates;
}

/** Prices for currencies mempool.space does not have (CNY, RUB, BRL, …). */
export async function fetchBlockchainTicker(): Promise<Record<string, number>> {
  const data = await requestJson<Record<string, { last?: number }>>(BLOCKCHAIN_TICKER_URL);
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(data)) {
    if (typeof value?.last === 'number' && value.last > 0) rates[code] = value.last;
  }
  return rates;
}

/**
 * Bitcoin price for the selected display currency: mempool.space for the
 * currencies it has, blockchain.info only for the others (asked only then). Refreshes every
 * few minutes while the app is in the foreground; does nothing when fiat is off.
 */
export function PriceProvider({ children }: { children: ReactNode }) {
  const { fiat } = usePreferences();
  const fromMempool = MEMPOOL_CURRENCIES.includes(fiat);
  const [state, setState] = useState<PriceState>({ rates: null, source: null, updatedAt: null });
  const enabled = fiat !== 'off';

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let lastFetch = 0;

    const load = async () => {
      lastFetch = Date.now();
      const rates = await (fromMempool ? fetchMempool() : fetchBlockchainTicker()).catch(() => null);
      if (!cancelled && rates) setState({ rates, source: fromMempool ? 'mempool.space' : 'blockchain.info', updatedAt: new Date() });
    };

    void load();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Date.now() - lastFetch > REFRESH_MS) void load();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, fromMempool]);

  const value = useMemo(() => state, [state]);
  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function usePrice(): PriceState {
  return useContext(PriceContext);
}
