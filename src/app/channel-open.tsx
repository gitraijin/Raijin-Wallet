import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { FeePicker } from '@/components/FeePicker';
import {
  Button,
  ErrorText,
  Header,
  InfoRow,
  Input,
  Label,
  Mono,
  Panel,
  Screen,
  Segmented,
} from '@/components/ui';
import { errorMessage, truncateMiddle } from '@/lib/format';
import { parseNodeUri } from '@/lightning/lnd-channels';
import { useT } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';
import { HoldButton } from '@/motion/HoldButton';
import { scanInto } from '@/lib/scan-result';
import { usePaymentAuth } from '@/security/usePaymentAuth';

/** LND's default minimum channel size (minchansize). */
const MIN_CHANNEL_SATS = 20_000n;

type Visibility = 'public' | 'private';

export default function ChannelOpen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend, breakdown, refresh } = useWallet();
  const t = useT();
  const paymentAuth = usePaymentAuth();
  const btc = useAmount();
  const params = useLocalSearchParams<{ node?: string }>();
  const [node, setNode] = useState(params.node ?? '');
  const [amount, setAmount] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [feeRate, setFeeRate] = useState<number | undefined>(undefined);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const onFeeChange = useCallback((rate: number | undefined) => setFeeRate(rate), []);

  const nodeTrimmed = node.trim();
  let nodeError: string | null = null;
  if (nodeTrimmed) {
    try {
      parseNodeUri(nodeTrimmed);
    } catch (e) {
      nodeError = errorMessage(e);
    }
  }
  const sats = btc.parse(amount);
  const available = breakdown?.onchainSats;
  const amountError =
    amount.trim() === ''
      ? null
      : sats === undefined
        ? t(btc.invalidKey)
        : sats < MIN_CHANNEL_SATS
          ? t('open.min', { amount: btc.format(MIN_CHANNEL_SATS) })
          : available !== undefined && sats > available
            ? t('open.tooMuch')
            : null;
  const ready =
    nodeTrimmed !== '' && !nodeError && sats !== undefined && !amountError && feeRate !== undefined;

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setNode(text.trim());
  };

  const open = async () => {
    if (!backend?.channels || sats === undefined || feeRate === undefined) return;
    if (!(await paymentAuth(sats, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await backend.channels.open({
        nodeUri: nodeTrimmed,
        amountSats: sats,
        satPerVbyte: feeRate,
        private: visibility === 'private',
      });
      setOpened(result.channelPoint);
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (opened) {
    return (
      <Screen>
        <Header title={t('open.title')} back={false} />
        <View style={styles.result}>
          <Mono style={[styles.resultMark, { color: colors.success }]}>{'[ OK ]'}</Mono>
          <Mono style={styles.hint}>{t('open.done')}</Mono>
          <InfoRow
            k={t('channel.point')}
            v={truncateMiddle(opened, 10)}
            onPress={() => void Clipboard.setStringAsync(opened)}
          />
        </View>
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (reviewing && sats !== undefined && feeRate !== undefined) {
    return (
      <Screen scroll>
        <Header title={t('open.title')} />
        <Panel label={t('send.summary')} accent={colors.primary}>
          <InfoRow k={t('open.node')} v={truncateMiddle(nodeTrimmed, 12)} />
          <InfoRow k={t('open.size')} v={btc.format(sats)} strong />
          <InfoRow k={t('fee.label')} v={`${feeRate} sat/vB`} />
          <InfoRow k={t('open.visibility')} v={t(`open.${visibility}`)} />
        </Panel>
        <Mono style={styles.hint}>{t('open.reviewHint')}</Mono>
        <ErrorText>{error}</ErrorText>
        <HoldButton label={t('open.confirm')} onConfirm={open} loading={busy} />
        <Button
          label={t('common.cancel')}
          variant="ghost"
          onPress={() => setReviewing(false)}
          disabled={busy}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('open.title')} />
      <View style={styles.field}>
        <Label>{t('open.node')}</Label>
        <Mono style={styles.hint}>{t('open.nodeHint')}</Mono>
        <Input value={node} onChangeText={setNode} multiline placeholder="pubkey@host:9735" />
        <Button label={t('common.paste')} variant="ghost" onPress={paste} />
        <Button
          label={t('scan.button')}
          variant="ghost"
          onPress={async () => {
            const scanned = await scanInto();
            if (scanned) setNode(scanned);
          }}
        />
        <ErrorText>{nodeError}</ErrorText>
      </View>
      <View style={styles.field}>
        <Label>{t('open.amount', { unit: btc.unitLabel })}</Label>
        <Input
          value={amount}
          onChangeText={setAmount}
          keyboardType={btc.keyboardType}
          placeholder={btc.placeholder}
        />
        {available !== undefined ? (
          <Mono style={styles.hint}>{t('open.available', { amount: btc.format(available) })}</Mono>
        ) : null}
        <ErrorText>{amountError}</ErrorText>
      </View>
      <View style={styles.field}>
        <Label>{t('open.visibility')}</Label>
        <Segmented
          options={[
            { value: 'public', label: t('open.public') },
            { value: 'private', label: t('open.private') },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
      </View>
      <FeePicker onChange={onFeeChange} />
      <Button label={t('open.review')} onPress={() => setReviewing(true)} disabled={!ready} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    field: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    result: { flex: 1, justifyContent: 'center', gap: space.md },
    resultMark: { fontFamily: fonts.bold, fontSize: 32 },
  }),
);
