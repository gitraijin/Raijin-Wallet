import { Pressable, StyleSheet, View } from 'react-native';

import { Chips, Label, Mono, Segmented } from '@/components/ui';
import { usePreferences } from '@/preferences/PreferencesContext';
import {
  ACCENT_COLORS,
  fonts,
  makeStyles,
  readableOn,
  space,
  type Theme,
  THEME_ORDER,
  type ThemeName,
  themes,
  type UiStyle,
  useTheme,
} from '@/theme';
import type { ThemeMode } from '@/theme-context';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const MORNING = [5, 6, 7, 8, 9];

/** Theme settings: fixed theme, follow the system, or by time of day; plus accent color. */
export function ThemePicker() {
  const styles = useStyles();
  const { t } = usePreferences();
  const { settings, updateSettings, setTheme, name: active } = useTheme();

  const darkThemes = THEME_ORDER.filter((n) => themes[n].dark);
  const lightThemes = THEME_ORDER.filter((n) => !themes[n].dark);

  return (
    <View style={styles.wrap}>
      <Label>{t('theme.style')}</Label>
      <Segmented<UiStyle>
        options={[
          { value: 'terminal', label: t('theme.style.terminal') },
          { value: 'fujin', label: t('theme.style.fujin') },
        ]}
        value={settings.uiStyle}
        onChange={(uiStyle) => updateSettings({ uiStyle })}
      />
      <Mono style={styles.hint}>{t('theme.styleHint')}</Mono>

      <Segmented<ThemeMode>
        options={[
          { value: 'manual', label: t('theme.mode.manual') },
          { value: 'system', label: t('theme.mode.system') },
          { value: 'schedule', label: t('theme.mode.schedule') },
        ]}
        value={settings.mode}
        onChange={(mode) => updateSettings({ mode })}
      />

      {settings.mode === 'manual' ? (
        <PreviewGrid names={THEME_ORDER} selected={settings.name} onSelect={setTheme} />
      ) : (
        <>
          <Mono style={styles.hint}>
            {settings.mode === 'system'
              ? t('theme.systemHint')
              : t('theme.scheduleHint', { from: settings.darkFrom, until: settings.darkUntil })}
          </Mono>
          <Label>{t('theme.dark')}</Label>
          <PreviewGrid names={darkThemes} selected={settings.dark} onSelect={(dark) => updateSettings({ dark })} />
          <Label>{t('theme.light')}</Label>
          <PreviewGrid names={lightThemes} selected={settings.light} onSelect={(light) => updateSettings({ light })} />
          {settings.mode === 'schedule' ? (
            <>
              <Label>{t('theme.darkFrom')}</Label>
              <Chips
                options={HOURS.map((h) => ({ value: String(h), label: `${h}:00` }))}
                value={String(settings.darkFrom)}
                onChange={(h) => updateSettings({ darkFrom: Number(h) })}
              />
              <Label>{t('theme.darkUntil')}</Label>
              <Chips
                options={MORNING.map((h) => ({ value: String(h), label: `${h}:00` }))}
                value={String(settings.darkUntil)}
                onChange={(h) => updateSettings({ darkUntil: Number(h) })}
              />
            </>
          ) : null}
          <Mono style={styles.hint}>{t('theme.activeNow', { name: themes[active].label })}</Mono>
        </>
      )}

      <Label>{t('theme.accent')}</Label>
      <View style={styles.accents}>
        <Pressable
          onPress={() => updateSettings({ accent: null })}
          accessibilityRole="radio"
          accessibilityState={{ selected: settings.accent === null }}
          accessibilityLabel={t('theme.accentDefault')}
          style={[styles.accent, styles.accentDefault, settings.accent === null && styles.accentSelected]}>
          <Mono style={styles.accentDefaultText}>A</Mono>
        </Pressable>
        {ACCENT_COLORS.map((color) => {
          const selected = settings.accent === color;
          return (
            <Pressable
              key={color}
              onPress={() => updateSettings({ accent: color })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={color}
              style={[styles.accent, { backgroundColor: color }, selected && styles.accentSelected]}>
              {selected ? <Mono style={{ color: readableOn(color), fontFamily: fonts.bold }}>✓</Mono> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Mini home screens as theme swatches. */
function PreviewGrid({
  names,
  selected,
  onSelect,
}: {
  names: ThemeName[];
  selected: ThemeName;
  onSelect: (name: ThemeName) => void;
}) {
  const styles = useStyles();
  const { settings } = useTheme();
  return (
    <View style={styles.grid}>
      {names.map((name) => (
        <ThemePreview
          key={name}
          theme={themes[name]}
          accent={settings.accent}
          selected={name === selected}
          onPress={() => onSelect(name)}
          style={styles.tile}
        />
      ))}
    </View>
  );
}

function ThemePreview({
  theme,
  accent,
  selected,
  onPress,
  style,
}: {
  theme: Theme;
  accent: string | null;
  selected: boolean;
  onPress: () => void;
  style: object;
}) {
  const styles = useStyles();
  const c = theme.colors;
  const primary = accent ?? c.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${theme.label} theme`}
      style={[style, { backgroundColor: c.bg, borderColor: selected ? primary : c.border }]}>
      <View style={[styles.miniPanel, { backgroundColor: c.surface, borderColor: c.borderStrong }]}>
        <View style={[styles.miniLine, { width: '40%', backgroundColor: c.textFaint }]} />
        <Mono style={[styles.miniBalance, { color: primary }]}>21 000</Mono>
        <View style={[styles.miniLine, { width: '60%', backgroundColor: c.textDim }]} />
      </View>
      <View style={styles.miniButtons}>
        <View style={[styles.miniButton, { borderColor: c.accent }]} />
        <View style={[styles.miniButton, { backgroundColor: primary, borderColor: primary }]} />
      </View>
      <Mono style={[styles.name, { color: selected ? primary : c.text }]}>
        {selected ? `> ${theme.label}` : theme.label}
      </Mono>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    tile: { width: '48%', borderWidth: 2, padding: space.sm, gap: 6 },
    miniPanel: { borderWidth: 1, padding: 6, gap: 4 },
    miniLine: { height: 3 },
    miniBalance: { fontFamily: fonts.bold, fontSize: 14 },
    miniButtons: { flexDirection: 'row', gap: 4 },
    miniButton: { flex: 1, height: 10, borderWidth: 1 },
    name: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 },
    accents: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    accent: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    accentDefault: { borderColor: colors.borderStrong },
    accentDefaultText: { fontFamily: fonts.bold, color: colors.textDim },
    accentSelected: { borderColor: colors.text },
  }),
);
