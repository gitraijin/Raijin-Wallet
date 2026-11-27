import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { usePreferences } from '@/preferences/PreferencesContext';
import { useTheme } from '@/theme';

import { useMotion } from './index';

const LINE_GAP = 4;

/**
 * Optional CRT effect over the whole app (dark themes only): faint horizontal
 * lines plus a slow bright band. Never intercepts touches.
 */
export function Scanlines() {
  const { scanlines } = usePreferences();
  const { dark, colors } = useTheme();
  const motion = useMotion();
  const { height } = useWindowDimensions();
  const y = useSharedValue(-120);

  useEffect(() => {
    if (!motion) return;
    y.value = -120;
    y.value = withRepeat(withTiming(height + 120, { duration: 7000, easing: Easing.linear }), -1, false);
  }, [motion, height, y]);

  const band = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (!scanlines || !dark) return null;
  const lines = Math.ceil(height / LINE_GAP);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.line, { top: i * LINE_GAP }]} />
      ))}
      {motion ? <Animated.View style={[styles.band, { backgroundColor: colors.primary }, band]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.22)' },
  band: { position: 'absolute', left: 0, right: 0, height: 90, opacity: 0.035 },
});
