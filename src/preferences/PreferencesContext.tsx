import { useLocales } from 'expo-localization';
import * as SecureStore from '@/lib/secure-store';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { isLang, type Lang, resolveLang, type Translate, translator } from '@/i18n';
import { useTheme } from '@/theme';
import { BITCOIN_UNITS, type BitcoinUnit } from '@/lib/format';
import { setTorForAll } from '@/lightning/http';

const PREFS_KEY = 'raijin.prefs.v1';

/** Currencies with a price from mempool.space. */
export const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'HKD', 'TWD', 'RUB', 'BRL', 'MXN'] as const;
/** Currencies mempool.space prices directly; the others come from blockchain.info. */
export const MEMPOOL_CURRENCIES: readonly string[] = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export type Preferences = {
  language: Lang | 'auto';
  unit: BitcoinUnit;
  fiat: FiatCurrency | 'off';
  /** Balances and amounts masked on the home screen. */
  hidden: boolean;
  /** Route all HTTP traffic (nodes, LNURL, prices) over Tor. Onion hosts always use Tor. */
  torAll: boolean;
  /** Animations: follow the system's "reduce motion" (auto), always, or never. */
  motion: 'auto' | 'on' | 'off';
  /** CRT scanline overlay in dark themes. */
  scanlines: boolean;
  /** Vibration feedback on payments and confirmations. */
  haptics: boolean;
  /** System notification when a payment arrives. */
  notifications: boolean;
  /** Block screenshots/recording and hide the app switcher preview. */
  screenProtection: boolean;
  /**
   * Payments up to this many sats need no PIN/biometrics (hold-to-confirm
   * only). 'always' = every payment asks, 'never' = no extra check.
   */
  pinLimit: 'always' | '1000' | '10000' | '100000' | 'never';
};

type PreferencesContextValue = Preferences & {
  loaded: boolean;
  /** Language actually in use (resolved from 'auto'). */
  lang: Lang;
  t: Translate;
  update: (patch: Partial<Preferences>) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function isFiat(value: unknown): value is FiatCurrency {
  return typeof value === 'string' && (FIAT_CURRENCIES as readonly string[]).includes(value);
}

/** Keeps only valid fields from whatever was stored. */
function sanitize(raw: unknown, fallback: Preferences): Preferences {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    language: v.language === 'auto' || isLang(v.language) ? v.language : fallback.language,
    unit: BITCOIN_UNITS.includes(v.unit as BitcoinUnit) ? (v.unit as BitcoinUnit) : fallback.unit,
    fiat: v.fiat === 'off' || isFiat(v.fiat) ? v.fiat : fallback.fiat,
    hidden: typeof v.hidden === 'boolean' ? v.hidden : fallback.hidden,
    torAll: typeof v.torAll === 'boolean' ? v.torAll : fallback.torAll,
    motion: v.motion === 'on' || v.motion === 'off' || v.motion === 'auto' ? v.motion : fallback.motion,
    scanlines: typeof v.scanlines === 'boolean' ? v.scanlines : fallback.scanlines,
    haptics: typeof v.haptics === 'boolean' ? v.haptics : fallback.haptics,
    notifications: typeof v.notifications === 'boolean' ? v.notifications : fallback.notifications,
    screenProtection: typeof v.screenProtection === 'boolean' ? v.screenProtection : fallback.screenProtection,
    pinLimit: (['always', '1000', '10000', '100000', 'never'] as const).includes(v.pinLimit as Preferences['pinLimit'])
      ? (v.pinLimit as Preferences['pinLimit'])
      : fallback.pinLimit,
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { uiStyle } = useTheme();
  const locales = useLocales();
  const device = locales[0];
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  useEffect(() => {
    const defaults: Preferences = {
      language: 'auto',
      unit: 'sat',
      fiat: isFiat(device?.currencyCode) ? device.currencyCode : 'USD',
      hidden: false,
      torAll: false,
      motion: 'auto',
      scanlines: false,
      haptics: true,
      notifications: true,
      screenProtection: true,
      pinLimit: '10000',
    };
    // The network routing must be set before anything connects, so it is
    // applied here rather than in an effect (child effects run first).
    const apply = (next: Preferences) => {
      setTorForAll(next.torAll);
      setPrefs(next);
    };
    SecureStore.getItemAsync(PREFS_KEY)
      .then((saved) => apply(sanitize(saved ? JSON.parse(saved) : null, defaults)))
      .catch(() => apply(defaults));
    // Defaults only matter on first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      setTorForAll(next.torAll);
      SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deviceLanguage = device?.languageCode ?? null;
  const value = useMemo<PreferencesContextValue>(() => {
    const current: Preferences = prefs ?? {
      language: 'auto',
      unit: 'sat',
      fiat: 'off',
      hidden: false,
      torAll: false,
      motion: 'auto',
      scanlines: false,
      haptics: true,
      notifications: true,
      screenProtection: true,
      pinLimit: '10000',
    };
    const lang = resolveLang(current.language, deviceLanguage);
    // Fujin style: plain sentences instead of the terminal "> " texts.
    return { ...current, loaded: prefs !== null, lang, t: translator(lang, uiStyle === 'fujin'), update };
  }, [prefs, deviceLanguage, update, uiStyle]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}

/** Shortcut for components that only need translations. */
export function useT(): Translate {
  return usePreferences().t;
}
