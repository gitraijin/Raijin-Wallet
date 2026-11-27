import { Pressable, View, StyleSheet } from 'react-native';

import { Mono } from '@/components/ui';
import type { TKey } from '@/i18n';
import { truncateMiddle } from '@/lib/format';
import type { Channel } from '@/lightning';
import { useT } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme, type ThemeColors } from '@/theme';

export function stateColor(state: Channel['state'], colors: ThemeColors): string {
  switch (state) {
    case 'active':
      return colors.success;
    case 'opening':
    case 'closing':
      return colors.accent;
    case 'force_closing':
      return colors.danger;
    default:
      return colors.textDim;
  }
}

export function channelName(channel: Channel): string {
  return channel.alias || truncateMiddle(channel.remotePubkey, 8);
}

/** Local (left) vs. remote (right) share of the channel capacity. */
export function LiquidityBar({ channel }: { channel: Channel }) {
  const styles = useStyles();
  const total = Number(channel.localSats + channel.remoteSats) || 1;
  const local = Number(channel.localSats) / total;
  return (
    <View style={styles.bar}>
      <View style={[styles.barLocal, { flex: local }]} />
      <View style={[styles.barRemote, { flex: 1 - local }]} />
    </View>
  );
}

export function ChannelCard({ channel, onPress }: { channel: Channel; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const amount = useAmount();
  const show = (sats: bigint) => (amount.hidden ? MASK : amount.value(sats));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.head}>
        <Mono style={styles.name} numberOfLines={1}>
          {channelName(channel)}
        </Mono>
        <Mono style={[styles.state, { color: stateColor(channel.state, colors) }]}>
          {t(`state.${channel.state}` as TKey)}
        </Mono>
      </View>
      <LiquidityBar channel={channel} />
      <View style={styles.head}>
        <Mono style={styles.amount}>{`↑ ${show(channel.localSats)}`}</Mono>
        <Mono style={styles.amount}>{`${show(channel.remoteSats)} ↓`}</Mono>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: space.md,
      gap: space.sm,
    },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
    name: { fontFamily: fonts.bold, fontSize: 14, flexShrink: 1 },
    state: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1.5 },
    amount: { color: colors.textDim, fontSize: 12 },
    bar: { flexDirection: 'row', height: 6, backgroundColor: colors.border },
    barLocal: { backgroundColor: colors.primary },
    barRemote: { backgroundColor: colors.accent, opacity: 0.5 },
  }),
);
