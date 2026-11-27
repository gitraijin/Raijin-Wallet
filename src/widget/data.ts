import * as SecureStore from '@/lib/secure-store';
import { BITCOIN_UNITS, type BitcoinUnit } from '@/lib/format';
import { DEFAULT_THEME, type ThemeColors, type ThemeName, themes } from '@/theme';

/**
 * What the home-screen widget shows. The app writes it after every refresh;
 * the widget's own periodic update reads it (and tries a fresh fetch).
 */
export type WidgetData = {
  nodeName: string;
  balanceSats: string;
  lightningSats: string | null;
  onchainSats: string | null;
  updatedAt: number;
};

const KEY = 'raijin.widget.v1';

export async function saveWidgetData(data: WidgetData): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(data));
}

export async function loadWidgetData(): Promise<WidgetData | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as WidgetData) : null;
  } catch {
    return null;
  }
}

/** Theme colors and "hide amounts" for the widget, read outside React. */
export async function loadWidgetLook(): Promise<{ colors: ThemeColors; hidden: boolean; unit: BitcoinUnit }> {
  let name: ThemeName = DEFAULT_THEME;
  let accent: string | null = null;
  let hidden = false;
  let unit: BitcoinUnit = 'sat';
  try {
    const theme = JSON.parse((await SecureStore.getItemAsync('raijin.theme.v2')) ?? '{}') as {
      mode?: string;
      name?: string;
      dark?: string;
      accent?: string | null;
    };
    const candidate = theme.mode && theme.mode !== 'manual' ? theme.dark : theme.name;
    if (candidate && candidate in themes) name = candidate as ThemeName;
    accent = theme.accent ?? null;
    const prefs = JSON.parse((await SecureStore.getItemAsync('raijin.prefs.v1')) ?? '{}') as {
      hidden?: boolean;
      unit?: string;
    };
    hidden = prefs.hidden === true;
    unit = BITCOIN_UNITS.includes(prefs.unit as BitcoinUnit) ? (prefs.unit as BitcoinUnit) : 'sat';
  } catch {
    // defaults
  }
  const colors = themes[name].colors;
  return { colors: accent ? { ...colors, primary: accent } : colors, hidden, unit };
}
