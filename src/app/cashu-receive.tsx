import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { emitPaymentReceived } from '@/motion/payments';
import { hostOf, inspectMint, inspectToken, receiveToken, type TokenPreview } from '@/cashu/wallet';
import { Button, ErrorText, Header, InfoRow, Input, Mono, Panel, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, useTheme } from '@/theme';
import { scanInto } from '@/lib/scan-result';

/** Paste a token, check it, swap it at its mint (adding the mint if needed). */
export default function CashuReceive() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const btc = useAmount();
  const params = useLocalSearchParams<{ token?: string }>();
  const { mints, addMint, reload } = useCashu();
  const [token, setToken] = useState(params.token ?? '');
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [done, setDone] = useState<{ amountSats: bigint; feeSats: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownMint = preview ? mints.find((m) => m.url === preview.mintUrl) : undefined;

  const check = (value = token) => {
    setError(null);
    setPreview(null);
    let parsed: TokenPreview;
    try {
      parsed = inspectToken(value);
    } catch {
      setError(t('cashu.tokenInvalid'));
      return;
    }
    if (parsed.unit !== 'sat') {
      setError(t('cashu.unitUnsupported', { unit: parsed.unit }));
      return;
    }
    setPreview(parsed);
  };

  const receive = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const mint = knownMint ?? (await addMint(await inspectMint(preview.mintUrl)));
      const received = await receiveToken(mint, token);
      emitPaymentReceived({ amountSats: received.amountSats, source: 'cashu', description: preview.memo });
      setDone(received);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await reload();
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Header title={t('cashu.receiveToken')} />
        <Mono style={{ color: colors.success }}>{t('cashu.received', { amount: btc.format(done.amountSats) })}</Mono>
        {done.feeSats > 0n ? <InfoRow k={t('cashu.feePaid')} v={btc.format(done.feeSats)} /> : null}
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={t('cashu.receiveToken')} />
      <Input
        value={token}
        onChangeText={(v) => {
          setToken(v);
          setPreview(null);
        }}
        placeholder="cashuB..."
        multiline
      />
      <Button
        label={t('common.paste')}
        variant="ghost"
        onPress={async () => {
          const text = (await Clipboard.getStringAsync()).trim();
          setToken(text);
          check(text);
        }}
      />
      <Button
        label={t('scan.button')}
        variant="ghost"
        onPress={async () => {
          const scanned = await scanInto();
          if (!scanned) return;
          const clean = scanned.replace(/^cashu:/i, '');
          setToken(clean);
          check(clean);
        }}
      />
      <ErrorText>{error}</ErrorText>
      {preview ? (
        <>
          <Panel label={t('cashu.token')}>
            <InfoRow k={t('send.amount')} v={btc.format(preview.amountSats)} strong />
            <InfoRow k={t('cashu.mint')} v={hostOf(preview.mintUrl)} />
            {preview.memo ? <InfoRow k={t('cashu.memo')} v={preview.memo} /> : null}
          </Panel>
          {!knownMint ? <Mono style={styles.warn}>{t('cashu.unknownMint')}</Mono> : null}
          <Button
            label={knownMint ? t('cashu.receive') : t('cashu.trustAndReceive')}
            onPress={receive}
            loading={busy}
          />
        </>
      ) : (
        <Button label={t('cashu.checkToken')} onPress={() => check()} disabled={token.trim() === ''} />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    warn: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  }),
);
