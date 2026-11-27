import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { InvoiceStatus } from '@/components/InvoiceStatus';
import { QrBlock } from '@/components/QrBlock';
import { Button, ErrorText, Header, Input, Label, Mono, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { useT } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Mode = 'lightning' | 'onchain';

export default function Receive() {
  const { backend } = useWallet();
  const t = useT();
  const [mode, setMode] = useState<Mode>('lightning');

  const options: { value: Mode; label: string }[] = [{ value: 'lightning', label: 'ϟ Lightning' }];
  if (backend?.info.onchainReceive) options.push({ value: 'onchain', label: '₿ On-chain' });
  const active = options.some((o) => o.value === mode) ? mode : 'lightning';

  return (
    <Screen scroll>
      <Header title={t('receive.title')} />
      {options.length > 1 ? <Segmented options={options} value={active} onChange={setMode} /> : null}
      {active === 'onchain' ? <OnchainReceive /> : <LightningReceive />}
    </Screen>
  );
}

function LightningReceive() {
  const styles = useStyles();
  const { backend } = useWallet();
  const t = useT();
  const btc = useAmount();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [invoice, setInvoice] = useState<{ value: string; fee: bigint; sats?: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountSats = btc.parse(amount);
  const amountInvalid = amount.trim() !== '' && amountSats === undefined;
  const amountFiat = amountSats ? btc.fiat(amountSats) : null;

  const createInvoice = async () => {
    if (!backend) return;
    setBusy(true);
    setError(null);
    try {
      const response = await backend.createInvoice({
        amountSats,
        description: description.trim(),
      });
      setInvoice({ value: response.invoice, fee: response.feeSats, sats: amountSats });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (invoice) {
    const fiat = invoice.sats ? btc.fiat(invoice.sats) : null;
    return (
      <View style={styles.block}>
        <Label>
          {invoice.sats !== undefined
            ? t('receive.invoiceAmount', { amount: btc.format(invoice.sats) })
            : t('receive.invoiceAny')}
        </Label>
        {fiat ? <Mono style={styles.hint}>{fiat}</Mono> : null}
        <QrBlock value={invoice.value} uri={`lightning:${invoice.value}`} />
        <InvoiceStatus invoice={invoice.value} amountSats={invoice.sats} />
        {invoice.fee > 0n ? (
          <Label>{t('receive.fee', { amount: btc.format(invoice.fee) })}</Label>
        ) : null}
        <Button label={t('receive.newInvoice')} variant="secondary" onPress={() => setInvoice(null)} />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.field}>
        <Label>{t('receive.amount', { unit: btc.unitLabel })}</Label>
        <Input
          value={amount}
          onChangeText={setAmount}
          keyboardType={btc.keyboardType}
          placeholder={btc.placeholder}
        />
        {amountFiat ? <Mono style={styles.hint}>{amountFiat}</Mono> : null}
      </View>
      <View style={styles.field}>
        <Label>{t('receive.description')}</Label>
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder={t('receive.descriptionPlaceholder')}
          maxLength={200}
        />
      </View>
      {amountInvalid ? <ErrorText>{t(btc.invalidKey)}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('receive.create')}
        onPress={createInvoice}
        loading={busy}
        disabled={!backend || amountInvalid}
      />
    </View>
  );
}

function OnchainReceive() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend } = useWallet();
  const t = useT();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAddress = useCallback(
    async (newAddress: boolean): Promise<string> => {
      if (!backend) throw new Error('Wallet not connected');
      return backend.getOnchainAddress(newAddress);
    },
    [backend],
  );

  // Load the current deposit address once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchAddress(false)
      .then((value) => !cancelled && setAddress(value))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [fetchAddress]);

  const rotateAddress = async () => {
    setError(null);
    setAddress(null);
    try {
      setAddress(await fetchAddress(true));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={styles.block}>
      <Mono style={styles.hint}>{t('receive.onchainHint')}</Mono>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : address ? (
        <>
          <Label>{t('receive.depositAddress')}</Label>
          <QrBlock value={address} uri={`bitcoin:${address}`} />
          <Button label={t('receive.newAddress')} variant="secondary" onPress={rotateAddress} />
        </>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    field: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
