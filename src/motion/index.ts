import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { usePreferences } from '@/preferences/PreferencesContext';

/**
 * Whether to animate. "auto" follows the system's reduce-motion setting
 * (Android: remove animations, iOS: reduce motion, desktop: prefers-reduced-motion).
 */
export function useMotion(): boolean {
  const { motion } = usePreferences();
  const reduced = useReducedMotion();
  return motion === 'on' || (motion === 'auto' && !reduced);
}

export type HapticKind = 'success' | 'error' | 'warning' | 'tap' | 'heavy';

/** Vibration feedback, respecting the user's setting. Never throws. */
export function useHaptics(): (kind: HapticKind) => void {
  const { haptics } = usePreferences();
  return useCallback((kind: HapticKind) => {
    if (!haptics) return;
    const run = () => {
      switch (kind) {
        case 'success':
          return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        case 'error':
          return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        case 'warning':
          return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        case 'heavy':
          return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        default:
          return Haptics.selectionAsync();
      }
    };
    run().catch(() => {});
  }, [haptics]);
}
