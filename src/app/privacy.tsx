import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ErrorText, Header, Input, Label, Mono, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { torAvailable } from '@/net/tor';
import { DEFAULT_SERVERS, getCustomServer, getOnlyCustom, parseServer, serverLabel, setCustomServer, setOnlyCustom } from '@/onchain/electrum';
import { FIAT_CURRENCIES, type FiatCurrency, usePreferences } from '@/preferences/PreferencesContext';
import { makeStyles } from '@/theme';

type OnOff = 'on' | 'off';

/** The device's currency when it has prices, else USD. */
function deviceCurrency(): FiatCurrency {
  const code = getLocales()[0]?.currencyCode ?? '';
  return (FIAT_CURRENCIES as readonly string[]).includes(code) ? (code as FiatCurrency) : 'USD';
}

/**
 * Privacy before anything is set up: Tor for everything, the own Electrum
 * server (and never falling back to public ones), exchange rates. Reachable
 * from the first start and from creating a Bitcoin wallet.
 */
export default function PrivacySetup() {
  const styles = useStyles();
  const prefs = usePreferences();
  const { t } = prefs;
  const [server, setServer] = useState('');
  const [only, setOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCustomServer().then((s) => setServer(s ? serverLabel(s) : ''));
    getOnlyCustom().then(setOnly);
  }, []);

  const serverValid = !server.trim() || !!parseServer(server);
  const ready = serverValid && (!only || !!parseServer(server));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setCustomServer(server.trim() || null);
      await setOnlyCustom(only && !!server.trim());
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onOff = [
    { value: 'on' as OnOff, label: t('common.on') },
    { value: 'off' as OnOff, label: t('common.off') },
  ];

  return (
    <Screen scroll>
      <Header title={t('privacy.title')} />
      <Mono style={styles.text}>{t('privacy.intro')}</Mono>

      <Label>{t('privacy.tor')}</Label>
      {torAvailable ? (
        <>
          <Segmented<OnOff> options={onOff} value={prefs.torAll ? 'on' : 'off'} onChange={(v) => prefs.update({ torAll: v === 'on' })} />
          <Mono style={styles.text}>{t('privacy.torHint')}</Mono>
        </>
      ) : (
        <Mono style={styles.text}>{t('tor.unavailable')}</Mono>
      )}

      <Label>{t('privacy.server')}</Label>
      <Input value={server} onChangeText={setServer} placeholder="ssl://node.local:50002" autoCapitalize="none" autoCorrect={false} />
      {!serverValid ? <ErrorText>{t('electrum.invalid')}</ErrorText> : null}
      <Mono style={styles.text}>{t('privacy.serverHint')}</Mono>
      <Label>{t('privacy.only')}</Label>
      <Segmented<OnOff> options={onOff} value={only ? 'on' : 'off'} onChange={(v) => setOnly(v === 'on')} />
      <Mono style={styles.text}>{only ? t('privacy.onlyOn') : `${t('privacy.onlyOff')}\n${DEFAULT_SERVERS.map(serverLabel).join('\n')}`}</Mono>
      {only && !parseServer(server) ? <ErrorText>{t('privacy.onlyNeedsServer')}</ErrorText> : null}

      <Label>{t('privacy.prices')}</Label>
      <Segmented<OnOff>
        options={onOff}
        value={prefs.fiat === 'off' ? 'off' : 'on'}
        onChange={(v) => prefs.update({ fiat: v === 'off' ? 'off' : deviceCurrency() })}
      />
      <Mono style={styles.text}>{t('privacy.pricesHint')}</Mono>

      <ErrorText>{error}</ErrorText>
      <Button label={t('common.save')} onPress={save} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    text: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  }),
);
