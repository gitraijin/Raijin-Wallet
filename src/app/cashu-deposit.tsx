import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { emitPaymentReceived } from '@/motion/payments';
import type { CashuEntry } from '@/cashu/store';
import { checkMintQuote, createMintQuote, payMintQuoteWithNode } from '@/cashu/wallet';
import { MintPicker } from '@/components/MintPicker';
import { QrBlock } from '@/components/QrBlock';
import { Button, ErrorText, Header, Input, Label, Mono, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

const POLL_MS = 4000;

/** Lightning -> ecash: the mint issues an invoice, the node (or anyone) pays it. */
export default function CashuDeposit() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const btc = useAmount();
  const params = useLocalSearchParams<{ entry?: string }>();
  const { selectedMint, history, mintById, reload } = useCashu();
  const { backend } = useWallet();
  const [amount, setAmount] = useState('');
  const [entryId, setEntryId] = useState<string | null>(params.entry ?? null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entry: CashuEntry | undefined = history.find((e) => e.id === entryId);
  const mint = entry ? mintById(entry.mintId) : selectedMint;
  const amountSats = btc.parse(amount);
  const amountInvalid = amount.trim() !== '' && amountSats === undefined;

  // Poll the mint until the invoice is paid (by the node or another wallet).
  useEffect(() => {
    if (!entry || entry.state !== 'pending' || !mint) return;
    let stopped = false;
    const tick = async () => {
      try {
        const state = await checkMintQuote(mint, entry);
        if (state === 'complete') emitPaymentReceived({ amountSats: BigInt(entry.amount), source: 'cashu' });
        if (state !== 'pending') await reload();
      } catch (e) {
        console.warn('[cashu] quote check failed', e);
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [entry, mint, reload]);

  const create = async () => {
    if (!mint || !amountSats) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createMintQuote(mint, amountSats);
      await reload();
      setEntryId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const payWithNode = async () => {
    if (!mint || !entry || !backend) return;
    setPaying(true);
    setError(null);
    try {
      const state = await payMintQuoteWithNode(mint, entry, backend);
      if (state === 'complete') emitPaymentReceived({ amountSats: BigInt(entry.amount), source: 'cashu' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await reload();
      setPaying(false);
    }
  };

  if (!mint) {
    return (
      <Screen>
        <Header title={t('cashu.deposit')} />
        <Mono style={styles.hint}>{t('cashu.noMint')}</Mono>
      </Screen>
    );
  }

  if (entry) {
    const sats = BigInt(entry.amount);
    return (
      <Screen scroll>
        <Header title={t('cashu.deposit')} />
        <Label>{`${mint.name} // ${btc.format(sats)}`}</Label>
        {entry.state === 'complete' ? (
          <Mono style={[styles.big, { color: colors.success }]}>{t('cashu.depositDone', { amount: btc.format(sats) })}</Mono>
        ) : entry.state === 'failed' ? (
          <ErrorText>{t('cashu.depositFailed')}</ErrorText>
        ) : entry.invoice ? (
          <View style={styles.block}>
            <Mono style={styles.hint}>{t('cashu.depositHint')}</Mono>
            {backend ? (
              <Button label={t('cashu.payWithNode')} onPress={payWithNode} loading={paying} />
            ) : null}
            <QrBlock value={entry.invoice} uri={`lightning:${entry.invoice}`} />
            <Label>{t('cashu.waiting')}</Label>
          </View>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('cashu.deposit')} />
      <MintPicker />
      <View style={styles.block}>
        <Label>{t('receive.amount', { unit: btc.unitLabel })}</Label>
        <Input value={amount} onChangeText={setAmount} keyboardType={btc.keyboardType} placeholder={btc.placeholder} />
        {amountSats ? <Mono style={styles.hint}>{btc.fiat(amountSats)}</Mono> : null}
      </View>
      {amountInvalid ? <ErrorText>{t(btc.invalidKey)}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('cashu.createInvoice')} onPress={create} loading={busy} disabled={!amountSats} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    big: { fontSize: 16, lineHeight: 24 },
  }),
);
