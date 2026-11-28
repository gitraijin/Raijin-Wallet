import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import * as SecureStore from '@/lib/secure-store';

import { applyUiStyle, DEFAULT_THEME, readableOn, type Theme, type ThemeColors, type ThemeName, themes, type UiStyle } from './theme';

const SETTINGS_KEY = 'raijin.theme.v2';
const LEGACY_KEY = 'raijin.theme.v1';

/**
 * manual:   always `name`
 * system:   follows the system's light/dark setting (`light` / `dark` theme)
 * schedule: `dark` theme from `darkFrom` to `darkUntil` o'clock, else `light`
 */
export type ThemeMode = 'manual' | 'system' | 'schedule';

export type ThemeSettings = {
  mode: ThemeMode;
  name: ThemeName;
  dark: ThemeName;
  light: ThemeName;
  /** Replaces the theme's primary color; null = theme default. */
  accent: string | null;
  darkFrom: number;
  darkUntil: number;
  /** Raijin's terminal look or Fujin's rounded look. */
  uiStyle: UiStyle;
};

// A function, not a constant: theme.ts re-exports this module, so values
// imported from it are not initialized yet while this module loads.
function defaultSettings(): ThemeSettings {
  return {
    mode: 'manual',
    name: DEFAULT_THEME,
    dark: DEFAULT_THEME,
    light: 'light',
    accent: null,
    darkFrom: 20,
    darkUntil: 7,
    // Fujin style (round and calm) by default since 0.2.0; Terminal stays one tap away.
    uiStyle: 'fujin',
  };
}

type ThemeContextValue = Theme & {
  uiStyle: UiStyle;
  settings: ThemeSettings;
  updateSettings: (patch: Partial<ThemeSettings>) => void;
  /** Picks a fixed theme (manual mode). */
  setTheme: (name: ThemeName) => void;
  /** False until the saved theme has been read, to avoid a flash of the default. */
  loaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in themes;
}

function isHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24;
}

function sanitize(raw: unknown): ThemeSettings {
  const DEFAULT_SETTINGS = defaultSettings();
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    mode: v.mode === 'system' || v.mode === 'schedule' ? v.mode : 'manual',
    name: isThemeName(v.name) ? v.name : DEFAULT_SETTINGS.name,
    dark: isThemeName(v.dark) && themes[v.dark].dark ? v.dark : DEFAULT_SETTINGS.dark,
    light: isThemeName(v.light) && !themes[v.light].dark ? v.light : DEFAULT_SETTINGS.light,
    accent: typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : null,
    darkFrom: isHour(v.darkFrom) ? v.darkFrom : DEFAULT_SETTINGS.darkFrom,
    darkUntil: isHour(v.darkUntil) ? v.darkUntil : DEFAULT_SETTINGS.darkUntil,
    uiStyle: v.uiStyle === 'terminal' || v.uiStyle === 'fujin' ? v.uiStyle : DEFAULT_SETTINGS.uiStyle,
  };
}

/** True if `hour` lies in [from, until), wrapping over midnight. */
export function inDarkHours(hour: number, from: number, until: number): boolean {
  if (from === until) return true;
  return from < until ? hour >= from && hour < until : hour >= from || hour < until;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const scheme = useColorScheme();
  const [hour, setHour] = useState(() => new Date().getHours());

  useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync(SETTINGS_KEY);
      if (saved) return sanitize(JSON.parse(saved));
      // Before v2 only the theme name was stored.
      const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
      return sanitize(isThemeName(legacy) ? { name: legacy, dark: legacy } : null);
    })()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // The schedule needs the current hour; once a minute is plenty.
  useEffect(() => {
    if (settings.mode !== 'schedule') return;
    const timer = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(timer);
  }, [settings.mode]);

  const updateSettings = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((current) => {
      const next = sanitize({ ...current, ...patch });
      SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setTheme = useCallback(
    (name: ThemeName) => updateSettings({ mode: 'manual', name }),
    [updateSettings],
  );

  const activeName: ThemeName =
    settings.mode === 'system'
      ? scheme === 'light'
        ? settings.light
        : settings.dark
      : settings.mode === 'schedule'
        ? inDarkHours(hour, settings.darkFrom, settings.darkUntil)
          ? settings.dark
          : settings.light
        : settings.name;

  const colors = useMemo<ThemeColors>(() => {
    const base = themes[activeName].colors;
    return settings.accent
      ? { ...base, primary: settings.accent, onPrimary: readableOn(settings.accent) }
      : base;
  }, [activeName, settings.accent]);

  // Swap fonts and radii before anything below renders (idempotent).
  applyUiStyle(settings.uiStyle);

  const value = useMemo(
    () => ({ ...themes[activeName], colors, settings, updateSettings, setTheme, loaded, uiStyle: settings.uiStyle }),
    [activeName, colors, settings, updateSettings, setTheme, loaded],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Theme-aware StyleSheet. Define once at module level, call the returned hook
 * inside the component:
 *
 *   const useStyles = makeStyles((colors) => StyleSheet.create({ box: { backgroundColor: colors.surface } }));
 *   function Box() { const styles = useStyles(); ... }
 */
export function makeStyles<T>(factory: (colors: ThemeColors) => T) {
  // Per colors and UI style: factories read the current `fonts` and `shape`.
  const cache = new WeakMap<ThemeColors, Partial<Record<UiStyle, T>>>();
  return function useStyles(): T {
    const { colors, uiStyle } = useTheme();
    let byStyle = cache.get(colors);
    if (!byStyle) {
      byStyle = {};
      cache.set(colors, byStyle);
    }
    let styles = byStyle[uiStyle];
    if (!styles) {
      styles = factory(colors);
      byStyle[uiStyle] = styles;
    }
    return styles;
  };
}
