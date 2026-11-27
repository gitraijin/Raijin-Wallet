import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChannelCard } from '@/components/ChannelCard';
import { Button, ErrorText, Header, InfoRow, Mono, Panel } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { makeStyles, space, useTheme } from '@/theme';
import { useChannels } from '@/wallet/useChannels';
import { useWallet } from '@/wallet/WalletContext';

export default function Channels() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend, breakdown, refresh } = useWallet();
  const { supported, channels, error, reload } = useChannels();
  const t = useT();
  const amount = useAmount();
  const [refreshing, setRefreshing] = useState(false);
  const show = (sats: bigint) => (amount.hidden ? MASK : amount.format(sats));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reload(), refresh()]);
    setRefreshing(false);
  }, [reload, refresh]);

  const active = (channels ?? []).filter((c) => c.state === 'active');
  const canSend = active.reduce((sum, c) => sum + c.localSats, 0n);
  const canReceive = active.reduce((sum, c) => sum + c.remoteSats, 0n);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }>
        <Header title={t('channels.title')} />
        {!supported ? (
          <Mono style={styles.dim}>{t('channels.unsupported')}</Mono>
        ) : (
          <>
            <Panel label={t('channels.liquidity')}>
              <InfoRow k={t('channels.canSend')} v={show(canSend)} />
              <InfoRow k={t('channels.canReceive')} v={show(canReceive)} />
              {breakdown ? <InfoRow k={t('channels.onchain')} v={show(breakdown.onchainSats)} /> : null}
            </Panel>
            <Button label={t('channels.open')} onPress={() => router.push('/channel-open')} />
            {backend?.channels?.rebalance ? (
              <Button label={t('rebalance.title')} variant="ghost" onPress={() => router.push('/rebalance')} />
            ) : null}
            <ErrorText>{error}</ErrorText>
            {channels === null && !error ? (
              <ActivityIndicator color={colors.accent} />
            ) : channels && channels.length === 0 ? (
              <Mono style={styles.dim}>{t('channels.empty')}</Mono>
            ) : (
              (channels ?? []).map((channel) => (
                <ChannelCard
                  key={channel.channelPoint}
                  channel={channel}
                  onPress={() =>
                    router.push({ pathname: '/channel', params: { point: channel.channelPoint } })
                  }
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md, gap: space.md },
    dim: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  }),
);
