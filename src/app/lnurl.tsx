import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View, StyleSheet } from 'react-native';

import { Button, ErrorText, Header, InfoRow, Input, Label, Mono, Panel, Screen } from '@/components/ui';
import type { TKey } from '@/i18n';
import { errorMessage } from '@/lib/format';
import type { SendQuote } from '@/lightning';
import {
  type LnurlPay,
  type LnurlRequest,
  type LnurlSuccessAction,
  type LnurlWithdraw,
  requestLnurlInvoice,
  resolveLnurl,
  submitLnurlWithdraw,
} from '@/lightning/lnurl';
import { useT } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';
import { HoldButton } from '@/motion/HoldButton';
import { ResultMark } from '@/motion/ResultMark';
import { usePaymentAuth } from '@/security/usePaymentAuth';

/** LNURL-pay, Lightning address and LNURL-withdraw. Opened from the send screen. */
export default function Lnurl() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { value } = useLocalSearchParams<{ value: string }>();
  const t = useT();
  const [request, setRequest] = useState<LnurlRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveLnurl(value ?? '')
      .then((r) => !cancelled && setRequest(r))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (request?.tag === 'payRequest') return <PayFlow pay={request} />;
  if (request?.tag === 'withdrawRequest') return <WithdrawFlow withdraw={request} />;

  return (
    <Screen>
      <Header title="lnurl" />
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </>
      ) : (
        <View style={styles.block}>
          <Mono style={styles.hint}>{t('lnurl.resolving')}</Mono>
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        </View>
      )}
    </Screen>
  );
}

function PayFlow({ pay }: { pay: LnurlPay }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend, refresh } = useWallet();
  const t = useT();
  const paymentAuth = usePaymentAuth();
  const btc = useAmount();
  const fixed = pay.minSats === pay.maxSats;
  const [amount, setAmount] = useState(fixed ? btc.value(pay.minSats).replace(/\s/g, '') : '');
  const [comment, setComment] = useState('');
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [action, setAction] = useState<LnurlSuccessAction | null>(null);
  const [done, setDone] = useState<'sent' | 'pending' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sats = btc.parse(amount);
  const outOfRange = sats !== undefined && (sats < pay.minSats || sats > pay.maxSats);
  const amountError =
    amount.trim() === ''
      ? null
      : sats === undefined
        ? t(btc.invalidKey)
        : outOfRange
          ? t('lnurl.range', { min: btc.format(pay.minSats), max: btc.format(pay.maxSats) })
          : null;
  const recipient = pay.address ?? pay.domain;

  const review = async () => {
    if (!backend || sats === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { invoice, successAction } = await requestLnurlInvoice(pay, sats, comment);
      setAction(successAction);
      setQuote(await backend.prepareSend({ destination: invoice }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!quote) return;
    if (!(await paymentAuth(quote.amountSats, t('auth.payment')))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await quote.confirm();
      if (result.state === 'failed') throw new Error(t('send.failed'));
      setDone(result.state === 'complete' ? 'sent' : 'pending');
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Header title={t('send.title')} back={false} />
        <View style={styles.result}>
          <ResultMark kind={done === 'sent' ? 'success' : 'pending'} label={done === 'sent' ? '[ OK ]' : '[ .. ]'} />
          <Mono style={styles.hint}>{done === 'sent' ? t('send.sent') : t('send.pending')}</Mono>
          {done === 'sent' && action ? (
            <Panel label={recipient}>
              {action.tag === 'message' ? (
                <Mono>{action.message}</Mono>
              ) : (
                <>
                  <Mono>{action.description}</Mono>
                  <Button label={t('lnurl.openLink')} variant="ghost" onPress={() => Linking.openURL(action.url)} />
                </>
              )}
            </Panel>
          ) : null}
        </View>
        {done === 'sent' && pay.address ? (
          <Button
            label={t('contacts.saveAddress')}
            variant="ghost"
            onPress={() => router.push({ pathname: '/contacts', params: { address: pay.address } })}
          />
        ) : null}
        <Button label={t('common.done')} onPress={() => router.dismissAll()} />
      </Screen>
    );
  }

  if (quote) {
    const fmt = (v: bigint) => {
      const fiat = btc.fiat(v);
      return fiat ? `${btc.format(v)}\n${fiat}` : btc.format(v);
    };
    return (
      <Screen scroll>
        <Header title={t('send.confirmTitle')} />
        <Panel label={t('send.summary')} accent={colors.primary}>
          <InfoRow k={t('send.to')} v={recipient} />
          {pay.description ? <InfoRow k={t('lnurl.description')} v={pay.description} /> : null}
          <InfoRow k={t('send.amount')} v={fmt(quote.amountSats)} strong />
          {quote.details?.map((d) => (
            <InfoRow key={d.key} k={t(`detail.${d.key}` as TKey)} v={'sats' in d ? btc.format(d.sats) : d.text} />
          ))}
          <InfoRow k={t('send.fee')} v={quote.feeSats !== undefined ? fmt(quote.feeSats) : '—'} />
        </Panel>
        <ErrorText>{error}</ErrorText>
        <HoldButton label={t('send.now')} onConfirm={send} loading={busy} />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setQuote(null)} disabled={busy} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('send.title')} />
      <Panel label={pay.address ? t('lnurl.address') : 'lnurl-pay'}>
        <InfoRow k={t('send.to')} v={recipient} />
        {pay.description ? <Mono style={styles.hint}>{pay.description}</Mono> : null}
        {!fixed ? (
          <Mono style={styles.hint}>
            {t('lnurl.range', { min: btc.format(pay.minSats), max: btc.format(pay.maxSats) })}
          </Mono>
        ) : null}
      </Panel>
      <View style={styles.field}>
        <Label>{t('open.amount', { unit: btc.unitLabel })}</Label>
        <Input
          value={amount}
          onChangeText={setAmount}
          editable={!fixed}
          keyboardType={btc.keyboardType}
          placeholder={btc.placeholder}
        />
        {sats ? <Mono style={styles.hint}>{btc.fiat(sats)}</Mono> : null}
        <ErrorText>{amountError}</ErrorText>
      </View>
      {pay.commentAllowed > 0 ? (
        <View style={styles.field}>
          <Label>{t('lnurl.comment', { n: pay.commentAllowed })}</Label>
          <Input value={comment} onChangeText={setComment} maxLength={pay.commentAllowed} />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('send.review')}
        onPress={review}
        loading={busy}
        disabled={!backend || sats === undefined || amountError !== null}
      />
    </Screen>
  );
}

function WithdrawFlow({ withdraw }: { withdraw: LnurlWithdraw }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend, refresh } = useWallet();
  const t = useT();
  const btc = useAmount();
  const [amount, setAmount] = useState(btc.value(withdraw.maxSats).replace(/\s/g, ''));
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sats = btc.parse(amount);
  const amountError =
    sats === undefined
      ? t(btc.invalidKey)
      : sats < withdraw.minSats || sats > withdraw.maxSats
        ? t('lnurl.range', { min: btc.format(withdraw.minSats), max: btc.format(withdraw.maxSats) })
        : null;

  const submit = async () => {
    if (!backend || sats === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { invoice } = await backend.createInvoice({
        amountSats: sats,
        description: withdraw.description || `LNURL-withdraw ${withdraw.domain}`,
      });
      await submitLnurlWithdraw(withdraw, invoice);
      setDone(true);
      setTimeout(() => void refresh(), 3000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Header title={t('lnurl.withdrawTitle')} back={false} />
        <View style={styles.result}>
          <Mono style={[styles.resultMark, { color: colors.success }]}>{'[ OK ]'}</Mono>
          <Mono style={styles.hint}>{t('lnurl.withdrawDone')}</Mono>
        </View>
        <Button label={t('common.done')} onPress={() => router.dismissAll()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('lnurl.withdrawTitle')} />
      <Panel label={withdraw.domain}>
        {withdraw.description ? <Mono style={styles.hint}>{withdraw.description}</Mono> : null}
        <Mono style={styles.hint}>
          {t('lnurl.range', { min: btc.format(withdraw.minSats), max: btc.format(withdraw.maxSats) })}
        </Mono>
      </Panel>
      <View style={styles.field}>
        <Label>{t('open.amount', { unit: btc.unitLabel })}</Label>
        <Input
          value={amount}
          onChangeText={setAmount}
          editable={withdraw.minSats !== withdraw.maxSats}
          keyboardType={btc.keyboardType}
          placeholder={btc.placeholder}
        />
        <ErrorText>{amount.trim() === '' ? null : amountError}</ErrorText>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('lnurl.withdraw')}
        onPress={submit}
        loading={busy}
        disabled={!backend || amountError !== null}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    field: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    spinner: { alignSelf: 'flex-start' },
    result: { flex: 1, justifyContent: 'center', gap: space.md },
    resultMark: { fontFamily: fonts.bold, fontSize: 32 },
  }),
);
