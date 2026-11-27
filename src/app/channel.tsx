import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { channelName, LiquidityBar, stateColor } from '@/components/ChannelCard';
import { ChannelPolicyPanel } from '@/components/ChannelPolicyPanel';
import { FeePicker } from '@/components/FeePicker';
import { Button, ErrorText, Header, InfoRow, Mono, Panel, Screen } from '@/components/ui';
import type { TKey } from '@/i18n';
import { errorMessage, truncateMiddle } from '@/lib/format';
import { useT } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useChannels } from '@/wallet/useChannels';
import { useWallet } from '@/wallet/WalletContext';
import { confirmAction } from '@/lib/confirm';

export default function ChannelDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { point } = useLocalSearchParams<{ point: string }>();
  const { backend, refresh } = useWallet();
  const { channels, error: loadError } = useChannels();
  const t = useT();
  const amount = useAmount();
  const [feeRate, setFeeRate] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState<'close' | 'force' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<{ txid: string | null } | null>(null);
  const onFeeChange = useCallback((rate: number | undefined) => setFeeRate(rate), []);

  const channel = channels?.find((c) => c.channelPoint === point);
  const show = (sats: bigint) => (amount.hidden ? MASK : amount.format(sats));
  const copy = (value: string) => void Clipboard.setStringAsync(value);

  const close = async (force: boolean) => {
    if (!backend?.channels || !channel) return;
    setBusy(force ? 'force' : 'close');
    setError(null);
    try {
      const result = await backend.channels.close({
        channelPoint: channel.channelPoint,
        force,
        satPerVbyte: force ? undefined : feeRate,
      });
      setClosed({ txid: result.closingTxid });
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (force: boolean) => {
    const ok = await confirmAction(
      force ? t('channel.forceTitle') : t('channel.closeTitle'),
      force ? t('channel.forceBody') : t('channel.closeBody'),
      force ? t('channel.forceClose') : t('channel.close'),
      t('common.cancel'),
    );
    if (ok) void close(force);
  };

  if (closed) {
    return (
      <Screen>
        <Header title={t('channel.title')} back={false} />
        <View style={styles.result}>
          <Mono style={[styles.resultMark, { color: colors.accent }]}>{'[ .. ]'}</Mono>
          <Mono style={styles.dim}>{closed.txid ? t('channel.closed') : t('channel.closePending')}</Mono>
          {closed.txid ? (
            <InfoRow k={t('channel.closingTxid')} v={truncateMiddle(closed.txid, 10)} onPress={() => copy(closed.txid!)} />
          ) : null}
        </View>
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!channel) {
    return (
      <Screen>
        <Header title={t('channel.title')} />
        {channels === null && !loadError ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Mono style={styles.dim}>{loadError ?? t('channel.notFound')}</Mono>
        )}
      </Screen>
    );
  }

  const closable = channel.state === 'active' || channel.state === 'inactive';

  return (
    <Screen scroll>
      <Header title={t('channel.title')} />
      <Panel
        label={channelName(channel)}
        accent={stateColor(channel.state, colors)}
        right={
          <Mono style={[styles.state, { color: stateColor(channel.state, colors) }]}>
            {t(`state.${channel.state}` as TKey)}
          </Mono>
        }>
        <LiquidityBar channel={channel} />
        <InfoRow k={t('channel.local')} v={show(channel.localSats)} />
        <InfoRow k={t('channel.remote')} v={show(channel.remoteSats)} />
        <InfoRow k={t('channel.capacity')} v={show(channel.capacitySats)} />
        {channel.limboSats ? <InfoRow k={t('channel.limbo')} v={show(channel.limboSats)} /> : null}
        {channel.maturityBlocks ? (
          <InfoRow k={t('channel.maturity')} v={t('channel.blocks', { n: channel.maturityBlocks })} />
        ) : null}
      </Panel>

      <Panel label={t('channel.details')}>
        <InfoRow
          k={t('channel.peer')}
          v={truncateMiddle(channel.remotePubkey, 8)}
          onPress={() => copy(channel.remotePubkey)}
        />
        <InfoRow
          k={t('channel.point')}
          v={truncateMiddle(channel.channelPoint, 8)}
          onPress={() => copy(channel.channelPoint)}
        />
        <InfoRow k={t('channel.private')} v={channel.private ? t('common.yes') : t('common.no')} />
        {channel.initiator !== undefined ? (
          <InfoRow k={t('channel.openedBy')} v={channel.initiator ? t('channel.us') : t('channel.peerSide')} />
        ) : null}
        <Mono style={styles.dim}>{t('channel.tapToCopy')}</Mono>
      </Panel>

      <ChannelPolicyPanel channel={channel} />

      {backend?.channels?.rebalance && channel.state === 'active' ? (
        <Button
          label={t('rebalance.title')}
          variant="ghost"
          onPress={() => router.push({ pathname: '/rebalance', params: { out: channel.channelPoint } })}
        />
      ) : null}

      {closable ? (
        <Panel label={t('channel.close')}>
          {channel.state === 'active' ? (
            <>
              <FeePicker onChange={onFeeChange} />
              <Button
                label={t('channel.close')}
                variant="secondary"
                onPress={() => confirm(false)}
                loading={busy === 'close'}
                disabled={busy !== null || feeRate === undefined}
              />
            </>
          ) : (
            <Mono style={styles.dim}>{t('channel.offlineHint')}</Mono>
          )}
          <Button
            label={t('channel.forceClose')}
            variant="danger"
            onPress={() => confirm(true)}
            loading={busy === 'force'}
            disabled={busy !== null}
          />
          <ErrorText>{error}</ErrorText>
        </Panel>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    dim: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    state: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1.5 },
    result: { flex: 1, justifyContent: 'center', gap: space.md },
    resultMark: { fontFamily: fonts.bold, fontSize: 32 },
  }),
);
