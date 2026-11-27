import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { channelName, LiquidityBar } from '@/components/ChannelCard';
import { Button, Chips, ErrorText, Header, InfoRow, Input, Label, Mono, Screen } from '@/components/ui';
import type { Channel } from '@/lightning';
import { errorMessage } from '@/lib/format';
import { HoldButton } from '@/motion/HoldButton';
import { ResultMark } from '@/motion/ResultMark';
import { useT } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { usePaymentAuth } from '@/security/usePaymentAuth';
import { makeStyles, space } from '@/theme';
import { useChannels } from '@/wallet/useChannels';
import { useWallet } from '@/wallet/WalletContext';

/**
 * Rebalancing: a payment to ourselves that leaves through a channel with
 * too much local balance and comes back through one with too little.
 * Costs routing fees; moves no funds out of the node.
 */
export default function Rebalance() {
  const styles = useStyles();
  const t = useT();
  const btc = useAmount();
  const paymentAuth = usePaymentAuth();
  const { out: initialOut } = useLocalSearchParams<{ out?: string }>();
  const { backend, refresh } = useWallet();
  const { channels } = useChannels();
  const active = (channels ?? []).filter((c) => c.state === 'active' && c.chanId);
  const [outPoint, setOutPoint] = useState(initialOut ?? '');
  const [inPoint, setInPoint] = useState('');
  const [amount, setAmount] = useState('');
  const [maxFee, setMaxFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const out = active.find((c) => c.channelPoint === outPoint);
  const into = active.find((c) => c.channelPoint === inPoint);
  const sats = btc.parse(amount);
  // Default fee cap: 0.1 % of the amount, at least 10 sat.
  const defaultFee = sats ? (sats / 1000n > 10n ? sats / 1000n : 10n) : 10n;
  const feeCap = maxFee.trim() ? btc.parse(maxFee) : defaultFee;
  const tooMuch = sats !== undefined && out !== undefined && sats > out.localSats;
  const ready = Boolean(out && into && out !== into && sats && sats > 0n && feeCap !== undefined && !tooMuch);

  const run = async () => {
    if (!backend?.channels?.rebalance || !out || !into || !sats || feeCap === undefined) return;
    if (!(await paymentAuth(sats + feeCap, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      const { feeSats } = await backend.channels.rebalance({
        outChannelPoint: out.channelPoint,
        inChannelPoint: into.channelPoint,
        amountSats: sats,
        maxFeeSats: feeCap,
      });
      setResult(feeSats);
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!backend?.channels?.rebalance) {
    return (
      <Screen>
        <Header title={t('rebalance.title')} />
        <Mono style={styles.hint}>{t('channels.unsupported')}</Mono>
      </Screen>
    );
  }

  if (result !== null) {
    return (
      <Screen>
        <Header title={t('rebalance.title')} back={false} />
        <ResultMark kind="success" label="[ OK ]" />
        <InfoRow k={t('send.amount')} v={btc.format(sats ?? 0n)} />
        <InfoRow k={t('send.fee')} v={btc.format(result)} />
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const picker = (value: string, onChange: (v: string) => void, exclude?: string) => (
    <Chips
      options={active
        .filter((c) => c.channelPoint !== exclude)
        .map((c: Channel) => ({
          value: c.channelPoint,
          label: `${channelName(c)} · ${btc.value(c.localSats)}/${btc.value(c.remoteSats)}`,
        }))}
      value={value}
      onChange={onChange}
    />
  );

  return (
    <Screen scroll>
      <Header title={t('rebalance.title')} />
      <Mono style={styles.hint}>{t('rebalance.intro')}</Mono>
      {active.length < 2 ? <Mono style={styles.hint}>{t('rebalance.needTwo')}</Mono> : null}

      <Label>{t('rebalance.from')}</Label>
      {picker(outPoint, setOutPoint)}
      {out ? <LiquidityBar channel={out} /> : null}

      <Label>{t('rebalance.to')}</Label>
      {picker(inPoint, setInPoint, outPoint)}
      {into ? <LiquidityBar channel={into} /> : null}

      <View style={styles.block}>
        <Label>{t('receive.amount', { unit: btc.unitLabel })}</Label>
        <Input value={amount} onChangeText={setAmount} keyboardType={btc.keyboardType} placeholder={btc.placeholder} />
        <Label>{t('rebalance.maxFee', { unit: btc.unitLabel })}</Label>
        <Input
          value={maxFee}
          onChangeText={setMaxFee}
          keyboardType={btc.keyboardType}
          placeholder={btc.value(defaultFee)}
        />
      </View>
      {tooMuch ? <ErrorText>{t('rebalance.tooMuch')}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <HoldButton label={t('rebalance.run')} onConfirm={run} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
