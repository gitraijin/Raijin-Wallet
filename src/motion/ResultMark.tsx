import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Mono } from '@/components/ui';
import { fonts, makeStyles, useTheme } from '@/theme';

import { useHaptics, useMotion } from './index';

export type ResultKind = 'success' | 'pending' | 'error';

/**
 * Big result mark: success flashes a lightning bolt, errors "glitch"
 * (short horizontal shake), pending just appears. Vibrates once.
 */
export function ResultMark({ kind, label }: { kind: ResultKind; label: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const motion = useMotion();
  const haptic = useHaptics();
  const scale = useSharedValue(motion && kind === 'success' ? 0.4 : 1);
  const glow = useSharedValue(motion && kind === 'success' ? 1 : 0);
  const shift = useSharedValue(0);

  useEffect(() => {
    haptic(kind === 'success' ? 'success' : kind === 'error' ? 'error' : 'warning');
    if (!motion) return;
    if (kind === 'success') {
      scale.value = withSequence(
        withTiming(1.25, { duration: 160, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 220 }),
      );
      glow.value = withTiming(0, { duration: 700 });
    } else if (kind === 'error') {
      shift.value = withSequence(
        withTiming(-8, { duration: 40 }),
        withTiming(7, { duration: 40 }),
        withTiming(-5, { duration: 40 }),
        withTiming(4, { duration: 40 }),
        withTiming(0, { duration: 40 }),
      );
    }
    // Runs once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const color = kind === 'success' ? colors.success : kind === 'error' ? colors.danger : colors.accent;
  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: shift.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.glow, { backgroundColor: color }, glowStyle]} pointerEvents="none" />
      <Animated.View style={markStyle}>
        <Mono style={[styles.bolt, { color }]}>{kind === 'success' ? 'ϟ' : kind === 'error' ? '✕' : '…'}</Mono>
      </Animated.View>
      <Mono style={[styles.label, { color }]}>{label}</Mono>
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
    glow: { position: 'absolute', width: 160, height: 160, borderRadius: 80, opacity: 0 },
    bolt: { fontFamily: fonts.bold, fontSize: 72, lineHeight: 84 },
    label: { fontFamily: fonts.bold, fontSize: 14, letterSpacing: 3 },
  }),
);
