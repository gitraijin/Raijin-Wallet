import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono } from '@/components/ui';
import { usePreferences } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';

import { useHaptics, useMotion } from './index';
import { onPaymentReceived, type ReceivedPayment } from './payments';

const COUNT_MS = 900;
const VISIBLE_MS = 3800;

/**
 * "+21 000 sat" banner when a payment arrives: slides in, the amount counts
 * up like a terminal counter, the border flashes, the phone vibrates.
 */
export function PaymentToast() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t, hidden } = usePreferences();
  const amount = useAmount();
  const motion = useMotion();
  const haptic = useHaptics();
  const insets = useSafeAreaInsets();
  const [payment, setPayment] = useState<ReceivedPayment | null>(null);
  const [shown, setShown] = useState(0n);
  const offset = useSharedValue(-160);
  const flash = useSharedValue(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () =>
      onPaymentReceived((next) => {
        haptic('success');
        setPayment(next);
      }),
    [haptic],
  );

  useEffect(() => {
    if (!payment) return;
    offset.value = motion ? withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }) : 0;
    flash.value = motion ? withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 900 })) : 0;

    // Count up from 0 to the amount.
    let frame: ReturnType<typeof setInterval> | null = null;
    if (motion) {
      const start = Date.now();
      frame = setInterval(() => {
        const ratio = Math.min(1, (Date.now() - start) / COUNT_MS);
        const eased = 1 - (1 - ratio) ** 3;
        setShown((payment.amountSats * BigInt(Math.round(eased * 1000))) / 1000n);
        if (ratio >= 1 && frame) clearInterval(frame);
      }, 30);
    }

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      offset.value = motion ? withTiming(-160, { duration: 220 }) : -160;
      setTimeout(() => setPayment(null), motion ? 240 : 0);
    }, VISIBLE_MS);
    return () => {
      if (frame) clearInterval(frame);
    };
  }, [payment, motion, offset, flash]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const glow = useAnimatedStyle(() => ({ opacity: flash.value }));

  if (!payment) return null;
  const tag = payment.source === 'cashu' ? 'ECASH' : payment.source === 'onchain' ? 'ON-CHAIN' : 'LIGHTNING';

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + space.sm }, slide]} pointerEvents="box-none">
      <Pressable
        onPress={() => setPayment(null)}
        accessibilityRole="alert"
        accessibilityLabel={t('toast.received', { amount: amount.format(payment.amountSats) })}
        style={[styles.toast, { borderColor: colors.success }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.success }, styles.flash, glow]} />
        <Mono style={styles.tag}>{`ϟ ${tag} // ${t('toast.title')}`}</Mono>
        <Mono style={[styles.amount, { color: colors.success }]}>
          {hidden ? `+${MASK}` : `+${amount.format(motion ? shown : payment.amountSats)}`}
        </Mono>
        {payment.description ? (
          <Mono style={styles.desc} numberOfLines={1}>
            {payment.description}
          </Mono>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 1000 },
    toast: {
      borderWidth: 1,
      backgroundColor: colors.surface,
      padding: space.md,
      gap: 2,
      overflow: 'hidden',
    },
    flash: { opacity: 0 },
    tag: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1.5, color: colors.textDim },
    amount: { fontFamily: fonts.bold, fontSize: 26 },
    desc: { fontSize: 12, color: colors.textDim },
  }),
);
