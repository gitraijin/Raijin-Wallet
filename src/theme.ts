/**
 * Raijin design tokens and themes.
 *
 * Colors are role-based so every theme can map them freely:
 * primary = main accent (buttons, amounts), accent = secondary highlight
 * (Lightning, active tabs), danger = errors/destructive, success = incoming.
 */

export type ThemeColors = {
  bg: string;
  surface: string;
  border: string;
  borderStrong: string;

  text: string;
  textDim: string;
  textFaint: string;

  primary: string;
  accent: string;
  danger: string;
  success: string;

  /** Text/icons drawn on top of `primary`. */
  onPrimary: string;
};

export type ThemeName =
  | 'nostr'
  | 'terminal'
  | 'matrix'
  | 'amber'
  | 'cyberpunk'
  | 'bitcoin'
  | 'oled'
  | 'light'
  | 'paper';

export type Theme = {
  name: ThemeName;
  label: string;
  dark: boolean;
  colors: ThemeColors;
};

export const themes: Record<ThemeName, Theme> = {
  nostr: {
    name: 'nostr',
    label: 'Nostr',
    dark: true,
    colors: {
      bg: '#0B0812',
      surface: '#140F1F',
      border: '#2A2140',
      borderStrong: '#3D2F5C',
      text: '#E8E0F5',
      textDim: '#8C7DAA',
      textFaint: '#4B4066',
      primary: '#9B4DFF',
      accent: '#F7931A',
      danger: '#FF3B6B',
      success: '#3DFF8B',
      onPrimary: '#FFFFFF',
    },
  },
  terminal: {
    name: 'terminal',
    label: 'Terminal',
    dark: true,
    colors: {
      bg: '#07080B',
      surface: '#0D1016',
      border: '#1E2533',
      borderStrong: '#2E3850',
      text: '#D6DEEB',
      textDim: '#5F6B7E',
      textFaint: '#3A4354',
      primary: '#F7931A',
      accent: '#00F0FF',
      danger: '#FF2E88',
      success: '#3DFF8B',
      onPrimary: '#07080B',
    },
  },
  matrix: {
    name: 'matrix',
    label: 'Matrix',
    dark: true,
    colors: {
      bg: '#000000',
      surface: '#04110A',
      border: '#0F3320',
      borderStrong: '#1A5233',
      text: '#B8FFD0',
      textDim: '#3FA866',
      textFaint: '#1E5C38',
      primary: '#00FF66',
      accent: '#7DFFB2',
      danger: '#FF3355',
      success: '#00FF66',
      onPrimary: '#000000',
    },
  },
  amber: {
    name: 'amber',
    label: 'Amber',
    dark: true,
    colors: {
      bg: '#0A0600',
      surface: '#140C02',
      border: '#3A2406',
      borderStrong: '#5C3A0A',
      text: '#FFC766',
      textDim: '#B07A22',
      textFaint: '#5E4012',
      primary: '#FFB000',
      accent: '#FFD27A',
      danger: '#FF5A36',
      success: '#FFE08A',
      onPrimary: '#0A0600',
    },
  },
  cyberpunk: {
    name: 'cyberpunk',
    label: 'Cyberpunk',
    dark: true,
    colors: {
      bg: '#0A0014',
      surface: '#140726',
      border: '#2E1350',
      borderStrong: '#4A1F7A',
      text: '#F2E9FF',
      textDim: '#A07CC8',
      textFaint: '#55377A',
      primary: '#FF2E97',
      accent: '#00F0FF',
      danger: '#FF4D4D',
      success: '#B6FF3D',
      onPrimary: '#0A0014',
    },
  },
  bitcoin: {
    name: 'bitcoin',
    label: 'Bitcoin',
    dark: true,
    colors: {
      bg: '#0C0C0C',
      surface: '#161616',
      border: '#2A2A2A',
      borderStrong: '#3F3F3F',
      text: '#F5F5F5',
      textDim: '#9A9A9A',
      textFaint: '#555555',
      primary: '#F7931A',
      accent: '#FFC56B',
      danger: '#FF4A4A',
      success: '#4ADE80',
      onPrimary: '#0C0C0C',
    },
  },
  oled: {
    name: 'oled',
    label: 'OLED',
    dark: true,
    colors: {
      bg: '#000000',
      surface: '#000000',
      border: '#1C1C1C',
      borderStrong: '#2E2E2E',
      text: '#E6E6E6',
      textDim: '#7A7A7A',
      textFaint: '#3D3D3D',
      primary: '#F7931A',
      accent: '#9B4DFF',
      danger: '#FF3B6B',
      success: '#3DFF8B',
      onPrimary: '#000000',
    },
  },
  light: {
    name: 'light',
    label: 'Light',
    dark: false,
    colors: {
      bg: '#F5F6FA',
      surface: '#FFFFFF',
      border: '#DCE1EA',
      borderStrong: '#BCC5D3',
      text: '#11151C',
      textDim: '#5B6678',
      textFaint: '#98A2B3',
      primary: '#D9730B',
      accent: '#0087A0',
      danger: '#D61F5C',
      success: '#11924A',
      onPrimary: '#FFFFFF',
    },
  },
  paper: {
    name: 'paper',
    label: 'Paper',
    dark: false,
    colors: {
      bg: '#F4EFE6',
      surface: '#FBF8F2',
      border: '#DDD3C2',
      borderStrong: '#BFB29C',
      text: '#2B241A',
      textDim: '#6E604B',
      textFaint: '#A69A86',
      primary: '#7A3FD1',
      accent: '#C2680A',
      danger: '#C0263F',
      success: '#2E7D32',
      onPrimary: '#FFFFFF',
    },
  },
};

export const DEFAULT_THEME: ThemeName = 'nostr';

/** Order in the theme picker: dark themes first. */
export const THEME_ORDER: ThemeName[] = [
  'nostr',
  'terminal',
  'matrix',
  'amber',
  'cyberpunk',
  'bitcoin',
  'oled',
  'light',
  'paper',
];

/** Accent colors the user can put on top of any theme (replaces `primary`). */
export const ACCENT_COLORS = [
  '#9B4DFF',
  '#F7931A',
  '#00F0FF',
  '#00FF66',
  '#FF2E97',
  '#FFB000',
  '#3D8BFF',
  '#FF3B3B',
] as const;

/** Black or white text, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? '#000000' : '#FFFFFF';
}

/** Color of the Raijin mark (horned oni head). Fixed across themes. */
export const brand = {
  mark: '#F7931A', // Bitcoin orange
} as const;

/**
 * UI style: 'terminal' is Raijin's own look (JetBrains Mono, square,
 * [ BRACKETS ], "> " texts); 'fujin' is the look of Fujin, the RaijinHub Nostr
 * app (Manrope, rounded, plain sentences). Colors come from the theme either way.
 */
export type UiStyle = 'terminal' | 'fujin';

const STYLE_FONTS: Record<UiStyle, { regular: string; medium: string; bold: string }> = {
  terminal: { regular: 'JetBrainsMono_400Regular', medium: 'JetBrainsMono_500Medium', bold: 'JetBrainsMono_700Bold' },
  fujin: { regular: 'Manrope_400Regular', medium: 'Manrope_600SemiBold', bold: 'Manrope_700Bold' },
};
const STYLE_SHAPE: Record<UiStyle, { radius: number; pill: number }> = {
  terminal: { radius: 0, pill: 0 },
  fujin: { radius: 14, pill: 999 },
};

/**
 * Current fonts and corner radii. Mutable on purpose: applyUiStyle() swaps
 * them, and makeStyles() rebuilds every StyleSheet when the style changes,
 * so the 50-odd places that read `fonts.bold` follow without changes.
 */
export const fonts = { ...STYLE_FONTS.terminal };
export const shape = { ...STYLE_SHAPE.terminal };

export function applyUiStyle(style: UiStyle) {
  Object.assign(fonts, STYLE_FONTS[style]);
  Object.assign(shape, STYLE_SHAPE[style]);
}

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

export { makeStyles, ThemeProvider, useTheme } from './theme-context';
