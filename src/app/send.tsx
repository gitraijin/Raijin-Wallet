import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';

import { CoinPicker } from '@/components/CoinPicker';
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
import type { TKey } from '@/i18n';
import { parsePaymentInput } from '@/lib/bitcoin';
import { errorMessage, truncateMiddle } from '@/lib/format';
import type { QuoteDetail, SendQuote, SendResult } from '@/lightning';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';
import { isCashuToken } from '@/cashu/wallet';
import { HoldButton } from '@/motion/HoldButton';
import { ResultMark } from '@/motion/ResultMark';
import { scanInto } from '@/lib/scan-result';
import { waitForContact } from '@/contacts/store';
import { usePaymentAuth } from '@/security/usePaymentAuth';

type AmountMode = 'amount' | 'all';

export default function Send() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend, breakdown, refresh } = useWallet();
  const { t } = usePreferences();
  const paymentAuth = usePaymentAuth();
  const btc = useAmount();
  const params = useLocalSearchParams<{ value?: string }>();
  const [destination, setDestination] = useState(params.value ?? '');
  const [amount, setAmount] = useState(() => {
    // A scanned BIP21 request brings its amount.
    const parsed = params.value ? parsePaymentInput(params.value) : null;
    return parsed?.type === 'onchain' && parsed.amountSats && !parsed.lightning
      ? btc.input(parsed.amountSats)
      : '';
  });
  const [amountMode, setAmountMode] = useState<AmountMode>('amount');
  const [amountInFiat, setAmountInFiat] = useState(false);
  const [feeRate, setFeeRate] = useState<number | undefined>(undefined);
  const [coins, setCoins] = useState<string[]>([]);
  const [coinControl, setCoinControl] = useState(false);
  const [summary, setSummary] = useState<SendQuote | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onFeeChange = useCallback((rate: number | undefined) => setFeeRate(rate), []);

  const input = parsePaymentInput(destination);
  const canOnchain = !!backend?.prepareOnchainSend;
  // A unified BIP21 QR with an invoice goes over lightning: faster and cheaper.
  const invoice =
    input.type === 'lightning' ? input.invoice : input.type === 'onchain' ? input.lightning : undefined;
  const onchain = input.type === 'onchain' && !invoice ? input : null;
  const onchainUnsupported = onchain !== null && !canOnchain;
  const sendAll = onchain !== null && amountMode === 'all';

  // Amounts can be typed in the bitcoin unit or, with a known price, in fiat.
  const inFiat = amountInFiat && btc.fiatCode !== null;
  const parsedAmount = inFiat ? btc.parseFiat(amount) : btc.parse(amount);
  const amountInvalid = !sendAll && amount.trim() !== '' && parsedAmount === undefined;
  const amountFiat = !sendAll && parsedAmount ? (inFiat ? `≈ ${btc.format(parsedAmount)}` : btc.fiat(parsedAmount)) : null;
  const toggleFiat = () => {
    if (parsedAmount !== undefined) setAmount(inFiat ? btc.input(parsedAmount) : btc.fiatInput(parsedAmount));
    setAmountInFiat(!inFiat);
  };
  const amountProps = {
    value: amount,
    onChangeText: setAmount,
    keyboardType: inFiat ? ('decimal-pad' as const) : btc.keyboardType,
    placeholder: inFiat ? '0.00' : btc.placeholder,
  };
  // Two separate chips: nested text with mixed fonts is measured too narrow on Android and cut off.
  const fiatSwitch = btc.fiatCode ? (
    <View style={styles.switchBox} accessibilityRole="radiogroup" accessibilityLabel={t('send.switchInput')}>
      {[
        { fiat: false, label: btc.unitLabel },
        { fiat: true, label: btc.fiatCode },
      ].map((option) => {
        const on = option.fiat === inFiat;
        return (
          <Pressable
            key={option.label}
            onPress={() => (on ? undefined : toggleFiat())}
            hitSlop={6}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.switchChip, on && { borderColor: colors.primary }]}>
            <Mono style={[styles.switch, on && styles.switchOn]} numberOfLines={1}>
              {option.label}
            </Mono>
          </Pressable>
        );
      })}
    </View>
  ) : null;
  const onchainReady =
    onchain !== null && feeRate !== undefined && (sendAll || (parsedAmount !== undefined && parsedAmount > 0n));

  const updateDestination = (value: string) => {
    // An ecash token is something to receive, not a payment destination.
    if (isCashuToken(value)) {
      router.replace({ pathname: '/cashu-receive', params: { token: value.trim() } });
      return;
    }
    setDestination(value);
    // Take over the amount of a BIP21 payment request.
    const parsed = parsePaymentInput(value);
    if (parsed.type === 'onchain' && parsed.amountSats && !parsed.lightning) {
      setAmount(btc.input(parsed.amountSats));
      setAmountInFiat(false);
      setAmountMode('amount');
    }
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) updateDestination(text.trim());
  };

  const prepare = async () => {
    if (!backend) return;
    if (input.type === 'lnurl') {
      router.push({ pathname: '/lnurl', params: { value: input.value } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (onchain && backend.prepareOnchainSend && feeRate !== undefined) {
        setSummary(
          await backend.prepareOnchainSend({
            address: onchain.address,
            amountSats: sendAll ? undefined : parsedAmount,
            sendAll,
            satPerVbyte: feeRate,
            label: onchain.label,
            outpoints: coins.length ? coins : undefined,
          }),
        );
      } else {
        setSummary(
          await backend.prepareSend({ destination: invoice ?? destination.trim(), amountSats: parsedAmount }),
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!summary) return;
    const total = summary.amountSats + (summary.feeSats ?? 0n);
    if (!(await paymentAuth(total, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await summary.confirm();
      if (sent.state === 'failed') throw new Error(t('send.failed'));
      setResult(sent);
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSummary(null);
    setError(null);
  };

  if (result) {
    const done = result.state === 'complete';
    return (
      <Screen>
        <Header title={t('send.title')} back={false} />
        <View style={styles.result}>
          <ResultMark kind={done ? 'success' : 'pending'} label={done ? '[ OK ]' : '[ .. ]'} />
          <Mono style={styles.resultText}>
            {result.txid ? t('send.broadcast') : done ? t('send.sent') : t('send.pending')}
          </Mono>
          {result.txid ? (
            <InfoRow
              k="txid"
              v={truncateMiddle(result.txid, 10)}
              onPress={() => void Clipboard.setStringAsync(result.txid!)}
            />
          ) : null}
        </View>
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (summary) {
    const fmt = (value: bigint) => {
      const fiat = btc.fiat(value);
      return fiat ? `${btc.format(value)}\n${fiat}` : btc.format(value);
    };
    const approx = summary.feeEstimated ? '≈ ' : '';
    const detailValue = (d: QuoteDetail) => ('sats' in d ? btc.format(d.sats) : d.text);
    const total = summary.feeSats !== undefined ? summary.amountSats + summary.feeSats : undefined;
    return (
      <Screen scroll>
        <Header title={t('send.confirmTitle')} />
        <Panel label={t('send.summary')} accent={colors.primary}>
          <InfoRow k={t('send.type')} v={t(`kind.${summary.kind}` as TKey)} />
          <InfoRow k={t('send.to')} v={truncateMiddle(summary.destination, 14)} />
          <InfoRow k={t('send.amount')} v={fmt(summary.amountSats)} />
          {summary.details?.map((d) => (
            <InfoRow key={d.key} k={t(`detail.${d.key}` as TKey)} v={detailValue(d)} />
          ))}
          <InfoRow
            k={t('send.fee')}
            v={summary.feeSats !== undefined ? `${approx}${fmt(summary.feeSats)}` : '—'}
          />
          {total !== undefined ? <InfoRow k={t('send.total')} v={`${approx}${fmt(total)}`} strong /> : null}
        </Panel>
        {summary.kind === 'onchain' ? (
          <Mono style={styles.hint}>{sendAll ? t('send.sweepHint') : t('send.onchainHint')}</Mono>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <HoldButton label={t('send.now')} onConfirm={send} loading={busy} />
        <Button label={t('common.cancel')} variant="ghost" onPress={reset} disabled={busy} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('send.title')} />
      <View style={styles.field}>
        <Label>{t('send.destination')}</Label>
        <Input
          value={destination}
          onChangeText={updateDestination}
          multiline
          placeholder={[...(backend?.info.sendTargets ?? []).map((x) => t(`target.${x}` as TKey)), t('target.lnurl')].join(' / ')}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button label={t('common.paste')} variant="ghost" onPress={paste} />
          </View>
          <View style={styles.flex}>
            <Button
              label={t('scan.button')}
              variant="ghost"
              onPress={async () => {
                const scanned = await scanInto();
                if (scanned) updateDestination(scanned);
              }}
            />
          </View>
        </View>
        <Button
          label={t('contacts.pick')}
          variant="ghost"
          onPress={async () => {
            const waiting = waitForContact();
            router.push({ pathname: '/contacts', params: { pick: '1' } });
            const contact = await waiting;
            if (contact) updateDestination(contact.address);
          }}
        />
        {invoice && input.type === 'onchain' ? (
          <Mono style={styles.hint}>{t('send.unifiedHint')}</Mono>
        ) : null}
        {onchain && canOnchain ? <Mono style={styles.hint}>{t('send.onchainDetected')}</Mono> : null}
        {input.type === 'lnurl' ? <Mono style={styles.hint}>{t('send.lnurlDetected')}</Mono> : null}
        {onchainUnsupported ? <ErrorText>{t('send.onchainUnsupported')}</ErrorText> : null}
      </View>

      {onchain && canOnchain ? (
        <>
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Label style={styles.labelText}>{t('send.amount')}</Label>
              {amountMode === 'amount' ? fiatSwitch : null}
            </View>
            <Segmented
              options={[
                { value: 'amount', label: t('send.amountMode') },
                { value: 'all', label: t('send.sendAll') },
              ]}
              value={amountMode}
              onChange={setAmountMode}
            />
            {amountMode === 'amount' ? <Input {...amountProps} /> : null}
            {amountFiat ? <Mono style={styles.hint}>{amountFiat}</Mono> : null}
            {breakdown ? (
              <Mono style={styles.hint}>
                {t('open.available', { amount: btc.format(breakdown.onchainSats) })}
              </Mono>
            ) : null}
          </View>
          <FeePicker onChange={onFeeChange} />
          {backend?.listUtxos ? (
            coinControl ? (
              <CoinPicker selected={coins} onChange={setCoins} />
            ) : (
              <Button label={t('coins.choose')} variant="ghost" onPress={() => setCoinControl(true)} />
            )
          ) : null}
        </>
      ) : onchain || input.type === 'lnurl' ? null : (
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Label style={styles.labelText}>{t('send.amountOptional', { unit: inFiat ? (btc.fiatCode ?? '') : btc.unitLabel })}</Label>
            {fiatSwitch}
          </View>
          <Input {...amountProps} />
          {amountFiat ? <Mono style={styles.hint}>{amountFiat}</Mono> : null}
        </View>
      )}

      {amountInvalid ? <ErrorText>{inFiat ? t('amount.invalidFiat') : t(btc.invalidKey)}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('send.review')}
        onPress={prepare}
        loading={busy}
        disabled={
          !backend ||
          destination.trim() === '' ||
          amountInvalid ||
          onchainUnsupported ||
          (onchain !== null && !onchainReady)
        }
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    field: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    // The label may wrap (it is long for invoices without amount); the switch keeps its width.
    labelText: { flex: 1 },
    switchBox: { flexShrink: 0, flexDirection: 'row', gap: space.xs },
    switchChip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.sm, paddingVertical: 4 },
    switch: { color: colors.textDim, fontSize: 12 },
    switchOn: { color: colors.primary, fontFamily: fonts.bold },
    result: { flex: 1, justifyContent: 'center', gap: space.md },
    row: { flexDirection: 'row', gap: space.sm },
    flex: { flex: 1 },
    resultText: { color: colors.textDim },
  }),
);
