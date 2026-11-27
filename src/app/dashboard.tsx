import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chips, ErrorText, Header, InfoRow, Label, Mono, Panel } from '@/components/ui';
import type { ForwardEvent, NodeStatus, RoutingSummary } from '@/lightning';
import { errorMessage, formatTimestamp, truncateMiddle } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

const PERIODS = ['1', '7', '30', '90'] as const;
type Period = (typeof PERIODS)[number];

/** Node dashboard (LND): status, routing fees, forwarding history. */
export default function Dashboard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const amount = useAmount();
  const { backend } = useWallet();
  const routing = backend?.routing;
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [summary, setSummary] = useState<RoutingSummary | null>(null);
  const [forwards, setForwards] = useState<ForwardEvent[]>([]);
  // Day index of the last load, for the per-day chart (no clock reads during render).
  const [today, setToday] = useState(0);
  const [period, setPeriod] = useState<Period>('7');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openForward, setOpenForward] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!routing) return;
    setError(null);
    try {
      const [s, f, events] = await Promise.all([routing.status(), routing.summary(), routing.forwards(Number(period))]);
      setStatus(s);
      setSummary(f);
      setForwards(events);
      setToday(Math.floor(Date.now() / 86_400_000));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [routing, period]);

  useEffect(() => {
    let cancelled = false;
    if (routing) {
      Promise.all([routing.status(), routing.summary(), routing.forwards(Number(period))])
        .then(([s, f, events]) => {
          if (cancelled) return;
          setStatus(s);
          setSummary(f);
          setForwards(events);
          setToday(Math.floor(Date.now() / 86_400_000));
        })
        .catch((e) => !cancelled && setError(errorMessage(e)));
    }
    return () => {
      cancelled = true;
    };
  }, [routing, period]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!routing) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Header title={t('dashboard.title')} />
          <Mono style={styles.dim}>{t('dashboard.unsupported')}</Mono>
        </View>
      </SafeAreaView>
    );
  }

  // Fees per day for the bar chart.
  const days = Number(period);
  const perDay = new Array<bigint>(days).fill(0n);
  for (const f of forwards) {
    const index = days - 1 - (today - Math.floor(f.timestamp / 86400));
    if (index >= 0 && index < days) perDay[index] += f.feeMsat;
  }
  const max = perDay.reduce((m, v) => (v > m ? v : m), 0n);
  const totalFeeMsat = forwards.reduce((s, f) => s + f.feeMsat, 0n);
  const volume = forwards.reduce((s, f) => s + f.amountOutSats, 0n);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <Header title={t('dashboard.title')} />
        <ErrorText>{error}</ErrorText>

        {status ? (
          <Panel label={status.alias || t('dashboard.node')}>
            <InfoRow
              k="pubkey"
              v={truncateMiddle(status.pubkey, 10)}
              onPress={() => void Clipboard.setStringAsync(status.uris[0] ?? status.pubkey)}
            />
            <InfoRow k={t('dashboard.version')} v={status.version.split(' ')[0]} />
            <InfoRow k={t('dashboard.block')} v={String(status.blockHeight)} />
            <InfoRow
              k={t('dashboard.sync')}
              v={`${status.syncedToChain ? '✓' : '✕'} chain  ${status.syncedToGraph ? '✓' : '✕'} graph`}
            />
            <InfoRow
              k={t('dashboard.channels')}
              v={t('dashboard.channelCounts', {
                active: status.activeChannels,
                inactive: status.inactiveChannels,
                pending: status.pendingChannels,
              })}
            />
            <InfoRow k={t('dashboard.peers')} v={String(status.peers)} />
          </Panel>
        ) : null}

        {summary ? (
          <Panel label={t('dashboard.fees')} accent={colors.borderStrong}>
            <InfoRow k={t('dashboard.day')} v={amount.format(summary.daySats)} />
            <InfoRow k={t('dashboard.week')} v={amount.format(summary.weekSats)} />
            <InfoRow k={t('dashboard.month')} v={amount.format(summary.monthSats)} strong />
            <InfoRow k={t('dashboard.avgFee')} v={`${summary.averageFeePpm} ppm`} />
          </Panel>
        ) : null}

        <Label>{t('dashboard.forwards')}</Label>
        <Chips
          options={PERIODS.map((p) => ({ value: p, label: t('dashboard.days', { days: p }) }))}
          value={period}
          onChange={setPeriod}
        />
        <View style={styles.chart} accessibilityLabel={t('dashboard.chart')}>
          {perDay.map((v, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  backgroundColor: v > 0n ? colors.primary : colors.border,
                  height: max > 0n ? Math.max(2, Number((v * 80n) / max)) : 2,
                },
              ]}
            />
          ))}
        </View>
        <InfoRow k={t('dashboard.count')} v={String(forwards.length)} />
        <InfoRow k={t('dashboard.volume')} v={amount.format(volume)} />
        <InfoRow k={t('dashboard.earned')} v={`${amount.format(totalFeeMsat / 1000n)} (${amount.group(totalFeeMsat)} msat)`} strong />

        {forwards.slice(0, 50).map((f, i) => {
          const key = `${f.timestamp}-${i}`;
          const open = openForward === key;
          return (
            <View key={key} style={styles.forward}>
              <Pressable
                onPress={() => setOpenForward(open ? null : key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                style={styles.row}>
                <View style={styles.left}>
                  <Mono style={styles.route} numberOfLines={1}>{`${open ? '▾' : '▸'} ${f.channelIn} → ${f.channelOut}`}</Mono>
                  <Mono style={styles.dim}>{formatTimestamp(f.timestamp)}</Mono>
                </View>
                <View style={styles.right}>
                  <Mono style={styles.amount}>{amount.format(f.amountOutSats)}</Mono>
                  <Mono style={[styles.dim, { color: colors.success }]}>{`+${amount.group(f.feeMsat)} msat`}</Mono>
                </View>
              </Pressable>
              {open ? <ForwardDetails forward={f} /> : null}
            </View>
          );
        })}
        {forwards.length === 0 ? <Mono style={styles.dim}>{t('dashboard.noForwards')}</Mono> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Expanded forward: both channels, exact amounts, fee and effective rate. */
function ForwardDetails({ forward: f }: { forward: ForwardEvent }) {
  const styles = useStyles();
  const { t } = usePreferences();
  const amount = useAmount();
  const outMsat = f.amountOutMsat ?? f.amountOutSats * 1000n;
  const inMsat = f.amountInMsat ?? f.amountInSats * 1000n;
  // Effective fee rate of this forward: fee / amount forwarded, in parts per million.
  const ppm = outMsat > 0n ? (f.feeMsat * 1_000_000n) / outMsat : 0n;
  const time = new Date(f.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const channel = (alias: string, id?: string) => (id && alias !== id ? `${alias}\n${id}` : alias);
  const copy = (id?: string) => (id ? () => void Clipboard.setStringAsync(id) : undefined);
  return (
    <View style={styles.details}>
      <InfoRow k={t('forward.time')} v={`${formatTimestamp(f.timestamp).slice(0, 10)} ${time}`} />
      <InfoRow k={t('forward.in')} v={channel(f.channelIn, f.chanIdIn)} onPress={copy(f.chanIdIn)} />
      <InfoRow k={t('forward.out')} v={channel(f.channelOut, f.chanIdOut)} onPress={copy(f.chanIdOut)} />
      <InfoRow k={t('forward.amountIn')} v={`${amount.format(f.amountInSats)}\n${amount.group(inMsat)} msat`} />
      <InfoRow k={t('forward.amountOut')} v={`${amount.format(f.amountOutSats)}\n${amount.group(outMsat)} msat`} />
      <InfoRow k={t('forward.fee')} v={`${amount.group(f.feeMsat)} msat`} strong />
      <InfoRow k={t('forward.rate')} v={`${amount.group(ppm)} ppm`} />
      {f.chanIdIn || f.chanIdOut ? <Mono style={styles.dim}>{t('forward.copyHint')}</Mono> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md, gap: space.md },
    dim: { color: colors.textDim, fontSize: 11 },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      height: 84,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderStrong,
    },
    bar: { flex: 1 },
    forward: { borderBottomWidth: 1, borderBottomColor: colors.border },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: space.md,
      paddingVertical: 6,
    },
    details: { gap: space.xs, paddingBottom: space.sm, paddingLeft: space.sm },
    left: { flexShrink: 1, gap: 2 },
    right: { alignItems: 'flex-end', gap: 2 },
    route: { fontFamily: fonts.medium, fontSize: 12 },
    amount: { fontFamily: fonts.bold, fontSize: 12 },
  }),
);
