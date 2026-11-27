import { getRandomBytes } from 'expo-crypto';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Mono } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, space } from '@/theme';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Fisher-Yates with the platform CSPRNG, so the layout is not predictable. */
function shuffled(items: string[]): string[] {
  const out = [...items];
  const random = getRandomBytes(out.length * 2);
  for (let i = out.length - 1; i > 0; i--) {
    const r = (random[i * 2] << 8) | random[i * 2 + 1];
    const j = r % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Numeric PIN entry whose keys change place every time it mounts, against
 * shoulder surfing and smudge patterns. Give it a new `key` to reshuffle and
 * clear it (e.g. after a wrong PIN).
 */
export function PinPad({
  length,
  onComplete,
  onBiometrics,
  disabled = false,
}: {
  length: number;
  onComplete: (pin: string) => void;
  /** Shows a biometrics key when set. */
  onBiometrics?: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const t = useT();
  const [pin, setPin] = useState('');
  const [order] = useState(() => shuffled(DIGITS));

  const press = (digit: string) => {
    if (disabled || pin.length >= length) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === length) {
      onComplete(next);
    }
  };

  const keys: (string | 'bio' | 'del' | null)[] = [
    ...order.slice(0, 9),
    onBiometrics ? 'bio' : null,
    order[9],
    'del',
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.dots} accessibilityLabel={t('pin.progress', { n: pin.length, total: length })}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
        ))}
      </View>
      <View style={styles.grid}>
        {keys.map((key, i) => {
          if (key === null) return <View key={`empty-${i}`} style={styles.key} />;
          const label = key === 'bio' ? '[ ◉ ]' : key === 'del' ? '<-' : key;
          const onPress =
            key === 'bio'
              ? onBiometrics
              : key === 'del'
                ? () => setPin((p) => p.slice(0, -1))
                : () => press(key);
          return (
            <Pressable
              key={key}
              onPress={onPress}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={key === 'bio' ? t('pin.useBio') : key === 'del' ? t('pin.delete') : key}
              style={({ pressed }) => [styles.key, styles.keyBorder, pressed && styles.keyPressed]}>
              <Mono style={[styles.keyLabel, key.length > 1 && styles.keyLabelSmall]}>{label}</Mono>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: space.lg, alignItems: 'center' },
    dots: { flexDirection: 'row', gap: space.md },
    dot: { width: 14, height: 14, borderWidth: 1, borderColor: colors.primary },
    dotFilled: { backgroundColor: colors.primary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 84 + 2 * space.sm, gap: space.sm },
    key: { width: 84, height: 64, alignItems: 'center', justifyContent: 'center' },
    keyBorder: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    keyPressed: { backgroundColor: colors.border },
    keyLabel: { fontFamily: fonts.bold, fontSize: 24, color: colors.text },
    keyLabelSmall: { fontSize: 14, color: colors.accent },
  }),
);
