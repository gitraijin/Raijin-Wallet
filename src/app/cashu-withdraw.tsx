import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { executeMelt, type MeltPreview, type MeltResult, prepareMelt } from '@/cashu/wallet';
import { MintPicker } from '@/components/MintPicker';
import { Button, ErrorText, Header, InfoRow, Input, Label, Mono, Panel, Screen, Segmented } from '@/components/ui';
import { errorMessage, truncateMiddle } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';
import { HoldButton } from '@/motion/HoldButton';
import { ResultMark } from '@/motion/ResultMark';
import { scanInto } from '@/lib/scan-result';
import { usePaymentAuth } from '@/security/usePaymentAuth';

type Mode = 'node' | 'invoice';

/** Ecash -> Lightning: to the connected node, or any invoice. */
export default function CashuWithdraw() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const paymentAuth = usePaymentAuth();
  const btc = useAmount();
  const { selectedMint, balances, reload } = useCashu();
  const { backend, activeNode } = useWallet();
  const [mode, setMode] = useState<Mode>(backend ? 'node' : 'invoice');
  const [amount, setAmount] = useState('');
  const [invoice, setInvoice] = useState('');
  const [preview, setPreview] = useState<MeltPreview | null>(null);
  const [result, setResult] = useState<MeltResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = selectedMint ? (balances[selectedMint.id] ?? 0n) : 0n;
  const amountSats = btc.parse(amount);

  const review = async () => {
    if (!selectedMint) return;
    setBusy(true);
    setError(null);
    try {
      let target = invoice.trim();
      if (mode === 'node') {
        if (!backend || !amountSats) return;
        target = (await backend.createInvoice({ amountSats, description: `cashu // ${selectedMint.name}` })).invoice;
      }
      setPreview(await prepareMelt(selectedMint, target));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    if (!(await paymentAuth(preview.amountSats + preview.feeReserveSats, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await executeMelt(preview));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await reload();
      setBusy(false);
    }
  };

  if (!selectedMint) {
    return (
      <Screen>
        <Header title={t('cashu.withdraw')} />
        <Mono style={styles.hint}>{t('cashu.noMint')}</Mono>
      </Screen>
    );
  }

  if (result) {
    return (
      <Screen>
        <Header title={t('cashu.withdraw')} />
        <ResultMark kind={result.state === 'complete' ? 'success' : 'pending'} label={result.state === 'complete' ? '[ OK ]' : '[ .. ]'} />
        <Mono style={{ color: result.state === 'complete' ? colors.success : colors.accent }}>
          {result.state === 'complete' ? t('cashu.withdrawDone') : t('cashu.withdrawPending')}
        </Mono>
        {preview ? <InfoRow k={t('send.amount')} v={btc.format(preview.amountSats)} /> : null}
        <InfoRow k={t('cashu.feePaid')} v={btc.format(result.feeSats)} />
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (preview) {
    const max = preview.amountSats + preview.feeReserveSats + preview.inputFeeSats;
    const enough = preview.spendableSats >= preview.amountSats;
    return (
      <Screen scroll>
        <Header title={t('cashu.withdraw')} />
        <Panel label={t('cashu.review')}>
          <InfoRow k={t('cashu.mint')} v={selectedMint.name} />
          <InfoRow k={t('send.to')} v={truncateMiddle(preview.invoice, 14)} />
          <InfoRow k={t('send.amount')} v={btc.format(preview.amountSats)} />
          <InfoRow k={t('cashu.feeReserve')} v={btc.format(preview.feeReserveSats + preview.inputFeeSats)} />
          <InfoRow k={t('cashu.maxTotal')} v={btc.format(max)} strong />
        </Panel>
        <Mono style={styles.hint}>{t('cashu.reserveNote')}</Mono>
        {!enough ? <ErrorText>{t('cashu.insufficient', { amount: btc.format(preview.spendableSats) })}</ErrorText> : null}
        <ErrorText>{error}</ErrorText>
        <HoldButton label={t('cashu.confirmWithdraw')} onConfirm={confirm} loading={busy} disabled={!enough} />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setPreview(null)} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('cashu.withdraw')} />
      <MintPicker />
      <Label>{t('cashu.available', { amount: btc.format(balance) })}</Label>
      {backend ? (
        <Segmented
          options={[
            { value: 'node', label: t('cashu.toNode') },
            { value: 'invoice', label: t('cashu.toInvoice') },
          ]}
          value={mode}
          onChange={setMode}
        />
      ) : null}
      {mode === 'node' ? (
        <View style={styles.block}>
          <Mono style={styles.hint}>{t('cashu.toNodeHint', { name: activeNode?.name ?? '—' })}</Mono>
          <Label>{t('receive.amount', { unit: btc.unitLabel })}</Label>
          <Input value={amount} onChangeText={setAmount} keyboardType={btc.keyboardType} placeholder={btc.placeholder} />
        </View>
      ) : (
        <View style={styles.block}>
          <Label>{t('cashu.invoice')}</Label>
          <Input value={invoice} onChangeText={setInvoice} placeholder="lnbc..." multiline />
          <Button
            label={t('common.paste')}
            variant="ghost"
            onPress={async () => setInvoice((await Clipboard.getStringAsync()).trim())}
          />
          <Button
            label={t('scan.button')}
            variant="ghost"
            onPress={async () => {
              const scanned = await scanInto();
              if (scanned) setInvoice(scanned.replace(/^lightning:/i, ''));
            }}
          />
        </View>
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('cashu.review')}
        onPress={review}
        loading={busy}
        disabled={mode === 'node' ? !amountSats : invoice.trim() === ''}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
