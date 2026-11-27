import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ErrorText, Label, Mono } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, space, type ThemeName, useTheme } from '@/theme';

const ICONS: { theme: ThemeName | null; name: string | null; source: number }[] = [
  { theme: null, name: null, source: require('@/assets/images/icon.png') },
  { theme: 'terminal', name: 'Terminal', source: require('@/assets/images/app-icons/terminal.png') },
  { theme: 'matrix', name: 'Matrix', source: require('@/assets/images/app-icons/matrix.png') },
  { theme: 'amber', name: 'Amber', source: require('@/assets/images/app-icons/amber.png') },
  { theme: 'cyberpunk', name: 'Cyberpunk', source: require('@/assets/images/app-icons/cyberpunk.png') },
  { theme: 'bitcoin', name: 'Bitcoin', source: require('@/assets/images/app-icons/bitcoin.png') },
  { theme: 'oled', name: 'Oled', source: require('@/assets/images/app-icons/oled.png') },
  { theme: 'light', name: 'Light', source: require('@/assets/images/app-icons/light.png') },
  { theme: 'paper', name: 'Paper', source: require('@/assets/images/app-icons/paper.png') },
];

/** Alternate launcher icons (Android/iOS). The default icon belongs to the Nostr theme. */
export function AppIconPicker() {
  const styles = useStyles();
  const { t } = usePreferences();
  const { colors, name: themeName } = useTheme();
  const [current, setCurrent] = useState<string | null>(() => getAppIconName());
  const [error, setError] = useState<string | null>(null);

  if (!supportsAlternateIcons) return null;

  const choose = async (name: string | null) => {
    setError(null);
    try {
      await setAlternateAppIcon(name);
      setCurrent(name);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const matching = ICONS.find((i) => i.theme === themeName)?.name ?? null;

  return (
    <View style={styles.wrap}>
      <Label>{t('appIcon.title')}</Label>
      <View style={styles.row}>
        {ICONS.map((icon) => {
          const selected = icon.name === current;
          return (
            <Pressable
              key={icon.name ?? 'default'}
              onPress={() => choose(icon.name)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={icon.name ?? 'Nostr'}
              style={[styles.icon, { borderColor: selected ? colors.primary : 'transparent' }]}>
              <Image source={icon.source} style={styles.image} />
            </Pressable>
          );
        })}
      </View>
      {matching !== current ? (
        <Pressable onPress={() => choose(matching)} hitSlop={8}>
          <Mono style={styles.link}>{`[ ${t('appIcon.matchTheme')} ]`}</Mono>
        </Pressable>
      ) : null}
      <Mono style={styles.hint}>{t('appIcon.hint')}</Mono>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: space.sm, marginTop: space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    icon: { borderWidth: 2, padding: 2 },
    image: { width: 44, height: 44 },
    link: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
    hint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  }),
);
