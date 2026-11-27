import { router } from 'expo-router';
import { Pressable, View, StyleSheet } from 'react-native';

import type { CashuEntry } from '@/cashu/CashuContext';
import { useCashu } from '@/cashu/CashuContext';
import { Mono } from '@/components/ui';
import type { TKey } from '@/i18n';
import { formatTimestamp } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';

const INCOMING = new Set<CashuEntry['kind']>(['mint', 'receive']);

/** One line of the ecash history; pending deposits and tokens open their detail screen. */
export function CashuEntryRow({ entry }: { entry: CashuEntry }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t, hidden } = usePreferences();
  const amount = useAmount();
  const { mintById } = useCashu();
  const incoming = INCOMING.has(entry.kind);
  const sats = BigInt(entry.amount);
  const fee = BigInt(entry.fee);

  const color =
    entry.state === 'failed'
      ? colors.danger
      : entry.state === 'pending'
        ? colors.accent
        : incoming
          ? colors.success
          : colors.text;

  const openable =
    entry.state === 'pending' && ((entry.kind === 'mint' && entry.invoice) || (entry.kind === 'send' && entry.token));

  const open = () => {
    if (entry.kind === 'mint') router.push({ pathname: '/cashu-deposit', params: { entry: entry.id } });
    else router.push({ pathname: '/cashu-token', params: { entry: entry.id } });
  };

  const row = (
    <View style={styles.row}>
      <View style={styles.left}>
        <Mono style={[styles.kind, { color }]}>
          {`${incoming ? '↓' : '↑'} ${t(`cashu.kind.${entry.kind}` as TKey)}`}
          {entry.state !== 'complete' ? `  ${t(`cashu.state.${entry.state}` as TKey)}` : ''}
        </Mono>
        <Mono style={styles.meta} numberOfLines={1}>
          {`${formatTimestamp(entry.timestamp)} // ${mintById(entry.mintId)?.name ?? '?'}`}
          {entry.memo ? ` // ${entry.memo}` : ''}
        </Mono>
      </View>
      <View style={styles.right}>
        <Mono style={[styles.amount, { color }]}>
          {hidden ? MASK : `${incoming ? '+' : '−'}${amount.format(sats)}`}
        </Mono>
        {fee > 0n && !hidden ? <Mono style={styles.meta}>{t('cashu.fee', { amount: amount.format(fee) })}</Mono> : null}
      </View>
    </View>
  );

  return openable ? (
    <Pressable onPress={open} accessibilityRole="button">
      {row}
    </Pressable>
  ) : (
    row
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: space.md,
      paddingVertical: space.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    left: { flexShrink: 1, gap: 2 },
    right: { alignItems: 'flex-end', gap: 2 },
    kind: { fontFamily: fonts.medium, fontSize: 13 },
    meta: { color: colors.textDim, fontSize: 11 },
    amount: { fontFamily: fonts.bold, fontSize: 13 },
  }),
);
