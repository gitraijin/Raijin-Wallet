import { StyleSheet, View } from 'react-native';

import { Mono } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';

const WIDTH = 20;

/** Terminal progress bar: "[██████░░░░░░] 45%". */
export function ProgressBar({ progress, label }: { progress: number; label?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const ratio = Math.max(0, Math.min(1, progress / 100));
  const filled = Math.round(ratio * WIDTH);
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}>
      {label ? <Mono style={styles.label}>{label}</Mono> : null}
      <Mono style={styles.bar}>
        <Mono style={{ color: colors.accent }}>{'█'.repeat(filled)}</Mono>
        <Mono style={{ color: colors.textFaint }}>{'░'.repeat(WIDTH - filled)}</Mono>
        <Mono style={styles.percent}>{` ${Math.round(progress)}%`}</Mono>
      </Mono>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: 4 },
    label: { color: colors.textDim, fontSize: 12 },
    bar: { fontSize: 13, letterSpacing: 0 },
    percent: { color: colors.textDim, fontSize: 12 },
  }),
);
