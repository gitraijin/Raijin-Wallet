import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Mono } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, space, useTheme } from '@/theme';

import { useHaptics, useMotion } from './index';

const HOLD_MS = 1200;
const BLOCKS = 12;

/**
 * Press-and-hold confirmation for payments: a terminal progress bar
 * "[████░░░░]" fills while held and triggers `onConfirm` when full. Letting go
 * early cancels. Prevents accidental payments from a stray tap.
 */
export function HoldButton({
  label,
  onConfirm,
  loading = false,
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const motion = useMotion();
  const haptic = useHaptics();
  const progress = useSharedValue(0);
  const [blocks, setBlocks] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);
  const inactive = disabled || loading;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const fire = () => {
    stop();
    haptic('heavy');
    onConfirm();
  };

  const start = () => {
    if (inactive) return;
    haptic('tap');
    started.current = Date.now();
    progress.value = 0;
    progress.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(fire);
    });
    // The text bar is updated from JS; the fill uses the animated value.
    timer.current = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - started.current) / HOLD_MS);
      setBlocks(Math.round(ratio * BLOCKS));
    }, 50);
  };

  const cancel = () => {
    if (!timer.current) return;
    stop();
    cancelAnimation(progress);
    progress.value = motion ? withTiming(0, { duration: 150 }) : 0;
    setBlocks(0);
  };

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const bar = `[${'█'.repeat(blocks)}${'░'.repeat(BLOCKS - blocks)}]`;

  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityHint={t('hold.hint')}
      accessibilityState={{ disabled: inactive }}
      // Screen readers cannot hold: a double tap confirms directly.
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && fire()}
      accessibilityActions={[{ name: 'activate' }]}
      style={[styles.button, { borderColor: colors.primary }, inactive && styles.disabled]}>
      <Animated.View style={[styles.fill, { backgroundColor: colors.primary }, fill]} />
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.content}>
          <Mono style={[styles.label, { color: blocks > BLOCKS / 2 ? colors.onPrimary : colors.primary }]}>
            {label.toUpperCase()}
          </Mono>
          <Mono style={[styles.bar, { color: blocks > BLOCKS / 2 ? colors.onPrimary : colors.textDim }]}>
            {blocks === 0 ? t('hold.label') : bar}
          </Mono>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    button: {
      borderWidth: 1,
      minHeight: 58,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      paddingVertical: space.sm,
    },
    disabled: { opacity: 0.35 },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    content: { alignItems: 'center', gap: 2 },
    label: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 2 },
    bar: { fontSize: 11, letterSpacing: 1 },
  }),
);
