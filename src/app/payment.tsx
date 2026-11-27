import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { FeePicker } from '@/components/FeePicker';
import { Button, ErrorText, Header, InfoRow, Input, Label, Mono, Panel, Screen } from '@/components/ui';
import type { TKey } from '@/i18n';
import { errorMessage, formatTimestamp, truncateMiddle } from '@/lib/format';
import { loadNotes, setNote } from '@/lib/notes';
import { recallPayment } from '@/lib/payment-cache';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

/** One payment in detail: hashes, preimage, txid, note, and fee bump for pending on-chain. */
export default function PaymentDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const btc = useAmount();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { payments, backend, refresh } = useWallet();
  const network = backend?.info.network ?? 'mainnet';
  const payment = payments.find((p) => p.id === id) ?? recallPayment(id ?? '');
  const [note, setNoteText] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [bumpRate, setBumpRate] = useState<number | undefined>(undefined);
  const [bumping, setBumping] = useState(false);
  const [bumpDone, setBumpDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadNotes().then((notes) => {
      if (!active || !id) return;
      setNoteText(notes[id] ?? '');
      setSavedNote(notes[id] ?? '');
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (!payment) {
    return (
      <Screen>
        <Header title={t('detail.title')} />
        <Mono style={styles.hint}>{t('detail.gone')}</Mono>
      </Screen>
    );
  }

  const incoming = payment.direction === 'in';
  const copy = (value: string) => () => void Clipboard.setStringAsync(value);
  const explorer = payment.txid
    ? `https://mempool.space/${network === 'testnet' ? 'testnet/' : network === 'signet' ? 'signet/' : ''}tx/${payment.txid}`
    : null;
  const canBump = payment.rail === 'onchain' && payment.state === 'pending' && backend?.bumpOnchainFee && payment.txid;

  const bump = async () => {
    if (!backend?.bumpOnchainFee || !payment.txid || bumpRate === undefined) return;
    setBumping(true);
    setError(null);
    try {
      await backend.bumpOnchainFee(payment.txid, bumpRate);
      setBumpDone(true);
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBumping(false);
    }
  };

  return (
    <Screen scroll>
      <Header title={t('detail.title')} />
      <Panel label={incoming ? t('detail.received') : t('detail.sent')} accent={colors.borderStrong}>
        <Mono style={[styles.amount, { color: incoming ? colors.success : colors.text }]}>
          {`${incoming ? '+' : '−'}${btc.format(payment.amountSats)}`}
        </Mono>
        {btc.fiat(payment.amountSats) ? <Mono style={styles.hint}>{btc.fiat(payment.amountSats)}</Mono> : null}
        <InfoRow k={t('detail.state')} v={t(`detail.state.${payment.state}` as TKey)} />
        <InfoRow k={t('detail.type')} v={payment.rail === 'onchain' ? 'on-chain' : 'lightning'} />
        <InfoRow k={t('detail.time')} v={formatTimestamp(payment.timestamp)} />
        {payment.feeSats > 0n ? <InfoRow k={t('send.fee')} v={btc.format(payment.feeSats)} /> : null}
        {payment.confirmations !== undefined ? (
          <InfoRow k={t('detail.confirmations')} v={String(payment.confirmations)} />
        ) : null}
        {payment.description ? <InfoRow k={t('detail.memo')} v={payment.description} /> : null}
      </Panel>

      <Panel label={t('detail.technical')}>
        {payment.paymentHash ? (
          <InfoRow k="hash" v={truncateMiddle(payment.paymentHash, 10)} onPress={copy(payment.paymentHash)} />
        ) : null}
        {payment.preimage ? (
          <InfoRow k="preimage" v={truncateMiddle(payment.preimage, 10)} onPress={copy(payment.preimage)} />
        ) : null}
        {payment.invoice ? (
          <InfoRow k={t('detail.invoice')} v={truncateMiddle(payment.invoice, 10)} onPress={copy(payment.invoice)} />
        ) : null}
        {payment.txid ? <InfoRow k="txid" v={truncateMiddle(payment.txid, 10)} onPress={copy(payment.txid)} /> : null}
        {payment.addresses?.slice(0, 3).map((a) => (
          <InfoRow key={a} k={t('detail.address')} v={truncateMiddle(a, 10)} onPress={copy(a)} />
        ))}
        <Mono style={styles.hint}>{t('detail.tapToCopy')}</Mono>
        {explorer ? (
          <Button label={t('detail.explorer')} variant="ghost" onPress={() => Linking.openURL(explorer)} />
        ) : null}
      </Panel>

      <View style={styles.block}>
        <Label>{t('detail.note')}</Label>
        <Input value={note} onChangeText={setNoteText} placeholder={t('detail.notePlaceholder')} maxLength={500} />
        {note !== savedNote ? (
          <Button
            label={t('detail.saveNote')}
            variant="secondary"
            onPress={async () => {
              await setNote(payment.id, note);
              setSavedNote(note.trim());
            }}
          />
        ) : null}
      </View>

      {canBump ? (
        <Panel label={t('detail.bump')}>
          <Mono style={styles.hint}>{t('detail.bumpHint')}</Mono>
          <FeePicker onChange={setBumpRate} />
          {bumpDone ? <Mono style={{ color: colors.success }}>{t('detail.bumpDone')}</Mono> : null}
          <Button label={t('detail.bumpRun')} onPress={bump} loading={bumping} disabled={bumpRate === undefined} />
        </Panel>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    amount: { fontSize: 28, fontFamily: fonts.bold },
  }),
);
