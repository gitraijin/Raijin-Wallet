import { router } from 'expo-router';
import { Pressable, View, StyleSheet } from 'react-native';

import { Mono } from '@/components/ui';
import { formatTimestamp } from '@/lib/format';
import { rememberPayment } from '@/lib/payment-cache';
import type { PaymentRail, WalletPayment } from '@/lightning';
import { usePreferences } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';

const RAIL_LABEL: Record<PaymentRail, string> = {
  lightning: 'LN',
  onchain: 'ONCHAIN',
  unknown: '???',
};

export function PaymentRow({ payment, note }: { payment: WalletPayment; note?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const amount = useAmount();
  const incoming = payment.direction === 'in';
  const statusColor =
    payment.state === 'failed'
      ? colors.danger
      : payment.state === 'pending'
        ? colors.accent
        : incoming
          ? colors.success
          : colors.text;

  const statusTag =
    payment.state === 'pending'
      ? t('payment.pending')
      : payment.state === 'failed'
        ? t('payment.failed')
        : '';

  const fmt = (value: bigint) => amount.format(value);
  const fiat = amount.fiat(payment.amountSats);

  const open = () => {
    rememberPayment(payment);
    router.push({ pathname: '/payment', params: { id: payment.id } });
  };

  return (
    <Pressable onPress={open} accessibilityRole="button" style={styles.row}>
      <Mono style={[styles.arrow, { color: statusColor }]}>{incoming ? '↓' : '↑'}</Mono>
      <View style={styles.middle}>
        <Mono style={styles.meta}>
          {RAIL_LABEL[payment.rail]}
          {statusTag}
        </Mono>
        <Mono style={styles.time}>{formatTimestamp(payment.timestamp)}</Mono>
        {note || payment.description ? (
          <Mono style={styles.time} numberOfLines={1}>
            {note ? `✎ ${note}` : payment.description}
          </Mono>
        ) : null}
      </View>
      <View style={styles.right}>
        <Mono style={[styles.amount, { color: statusColor }]}>
          {amount.hidden ? MASK : `${incoming ? '+' : '-'}${fmt(payment.amountSats)}`}
        </Mono>
        {amount.hidden ? null : fiat ? <Mono style={styles.time}>{fiat}</Mono> : null}
        {!amount.hidden && !incoming && payment.feeSats > 0n ? (
          <Mono style={styles.time}>{t('payment.fee', { amount: fmt(payment.feeSats) })}</Mono>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: space.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    arrow: { fontFamily: fonts.bold, fontSize: 18, width: 16 },
    middle: { flex: 1, gap: 2 },
    right: { alignItems: 'flex-end', gap: 2 },
    meta: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1 },
    time: { color: colors.textDim, fontSize: 11 },
    amount: { fontFamily: fonts.bold, fontSize: 15 },
  }),
);
