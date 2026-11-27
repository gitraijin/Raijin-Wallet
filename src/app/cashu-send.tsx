import { router } from 'expo-router';
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { sendToken } from '@/cashu/wallet';
import { MintPicker } from '@/components/MintPicker';
import { Button, ErrorText, Header, Input, Label, Mono, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, space } from '@/theme';
import { usePaymentAuth } from '@/security/usePaymentAuth';

/** Creates an ecash token to hand over (QR, chat, NFC ...). */
export default function CashuSend() {
  const styles = useStyles();
  const { t } = usePreferences();
  const paymentAuth = usePaymentAuth();
  const btc = useAmount();
  const { selectedMint, balances, reload } = useCashu();
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = selectedMint ? (balances[selectedMint.id] ?? 0n) : 0n;
  const amountSats = btc.parse(amount);
  const tooMuch = amountSats !== undefined && amountSats > balance;

  const create = async () => {
    if (!selectedMint || !amountSats) return;
    if (!(await paymentAuth(amountSats, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await sendToken(selectedMint, amountSats, memo.trim());
      await reload();
      router.replace({ pathname: '/cashu-token', params: { entry: entry.id } });
    } catch (e) {
      setError(errorMessage(e));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title={t('cashu.send')} />
      <MintPicker />
      <Label>{t('cashu.available', { amount: btc.format(balance) })}</Label>
      <View style={styles.block}>
        <Label>{t('receive.amount', { unit: btc.unitLabel })}</Label>
        <Input value={amount} onChangeText={setAmount} keyboardType={btc.keyboardType} placeholder={btc.placeholder} />
        {amountSats ? <Mono style={styles.hint}>{btc.fiat(amountSats)}</Mono> : null}
      </View>
      <View style={styles.block}>
        <Label>{t('cashu.memo')}</Label>
        <Input value={memo} onChangeText={setMemo} maxLength={100} placeholder={t('cashu.memoPlaceholder')} />
      </View>
      <Mono style={styles.hint}>{t('cashu.sendHint')}</Mono>
      {tooMuch ? <ErrorText>{t('cashu.insufficient', { amount: btc.format(balance) })}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('cashu.createToken')} onPress={create} loading={busy} disabled={!amountSats || tooMuch} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
