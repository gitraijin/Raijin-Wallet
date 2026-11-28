import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View, StyleSheet } from 'react-native';

import { AppIconPicker } from '@/components/AppIconPicker';
import { ElectrumPanel } from '@/components/ElectrumPanel';
import { ProgressBar } from '@/motion/ProgressBar';
import { desktop } from '@/lib/desktop';
import { backgroundChecksAvailable, ensureNotificationPermission } from '@/notify';
import { ThemePicker } from '@/components/ThemePicker';
import { Button, Chips, Header, Label, Mono, Panel, Screen, Segmented } from '@/components/ui';
import { type Lang, LANGUAGES } from '@/i18n';
import { formatTimestamp } from '@/lib/format';
import {
  FIAT_CURRENCIES,
  type FiatCurrency,
  type Preferences,
  usePreferences,
} from '@/preferences/PreferencesContext';
import { usePrice } from '@/preferences/PriceContext';
import { torAvailable, useTorStatus } from '@/net/tor';
import { clearDuressPin, hasDuressPin } from '@/security/pin';
import { useSecurity } from '@/security/SecurityContext';
import { makeStyles, space } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

const SOURCE_URL = 'https://github.com/'; // TODO: set once the public repository exists

export default function Settings() {
  const styles = useStyles();
  const { backend, activeNode } = useWallet();
  const prefs = usePreferences();
  const { t } = prefs;
  const price = usePrice();
  const security = useSecurity();
  const [securityNote, setSecurityNote] = useState<string | null>(null);

  const changePin = async () => {
    if (await security.authenticate(t('auth.changePin'))) {
      router.push({ pathname: '/pin-setup', params: { mode: 'change' } });
    }
  };

  const toggleBiometrics = async () => {
    setSecurityNote(null);
    const enable = !security.biometricsEnabled;
    if (!enable && !(await security.authenticate(t('auth.disableBio')))) return;
    const ok = await security.setBiometrics(enable);
    if (!ok) setSecurityNote(t('settings.bioNotConfirmed'));
  };

  const currencyOptions: { value: FiatCurrency | 'off'; label: string }[] = [
    { value: 'off', label: t('common.off') },
    ...FIAT_CURRENCIES.map((code) => ({ value: code, label: code })),
  ];
  const languageOptions: { value: Lang | 'auto'; label: string }[] = [
    { value: 'auto', label: t('settings.languageAuto') },
    ...LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
  ];
  const priceKnown = prefs.fiat !== 'off' && price.rates?.[prefs.fiat] !== undefined;

  return (
    <Screen scroll>
      <Header title={t('settings.title')} />

      <Panel label={t('settings.display')} collapsible>
        <Label>{t('settings.unit')}</Label>
        <Segmented
          options={[
            { value: 'sat', label: '1 000 sat' },
            { value: 'satDot', label: '1.000 sat' },
            { value: 'btc', label: 'BTC' },
          ]}
          value={prefs.unit}
          onChange={(unit) => prefs.update({ unit })}
        />
        <Label style={styles.gap}>{t('settings.currency')}</Label>
        <Chips options={currencyOptions} value={prefs.fiat} onChange={(fiat) => prefs.update({ fiat })} />
        {prefs.fiat !== 'off' ? (
          <Mono style={styles.dim}>
            {priceKnown && price.source
              ? `${t('settings.priceSource', { source: price.source })}${
                  price.updatedAt ? ` // ${formatTimestamp(price.updatedAt.getTime() / 1000)}` : ''
                }`
              : t('settings.priceMissing')}
          </Mono>
        ) : null}
      </Panel>

      <Panel label={t('settings.language')} collapsible defaultOpen={false}>
        <Chips
          options={languageOptions}
          value={prefs.language}
          onChange={(language) => prefs.update({ language })}
        />
      </Panel>

      <Panel label={t('settings.security')} collapsible defaultOpen={false}>
        <Info k={t('settings.appLock')} v={security.pinSet ? t('settings.pin') : t('common.off')} />
        <Info
          k={t('settings.biometrics')}
          v={
            !security.biometricsAvailable
              ? t('settings.notAvailable')
              : security.biometricsEnabled
                ? t('common.on')
                : t('common.off')
          }
        />
        <Mono style={styles.dim}>{t('settings.lockHint')}</Mono>
        {securityNote ? <Mono style={styles.dim}>{`> ${securityNote}`}</Mono> : null}
        <Button label={t('settings.changePin')} variant="ghost" onPress={changePin} />
        {security.biometricsAvailable ? (
          <Button
            label={security.biometricsEnabled ? t('settings.disableBio') : t('settings.enableBio')}
            variant="ghost"
            onPress={toggleBiometrics}
          />
        ) : null}
        <SecurityExtras />
      </Panel>

      <TorPanel />

      <ElectrumPanel />

      <Panel label={t('settings.theme')} collapsible defaultOpen={false}>
        <ThemePicker />
        <AppIconPicker />
      </Panel>

      <MotionPanel />

      <Panel label={t('nodes.title')} collapsible defaultOpen={false}>
        <Info k={t('nodes.active')} v={activeNode?.name ?? '—'} />
        <Button label={t('nodes.manage')} variant="ghost" onPress={() => router.push('/nodes')} />
      </Panel>

      <Panel label={t('settings.data')} collapsible defaultOpen={false}>
        <Button label={t('contacts.title')} variant="ghost" onPress={() => router.push('/contacts')} />
        <Button label={t('export.title')} variant="ghost" onPress={() => router.push('/export')} />
        {backend?.routing ? (
          <Button label={t('dashboard.title')} variant="ghost" onPress={() => router.push('/dashboard')} />
        ) : null}
      </Panel>

      <Panel label={t('settings.system')} collapsible defaultOpen={false}>
        <Info k={t('settings.network')} v={backend?.info.network ?? '—'} />
        <Info k={t('settings.version')} v={desktop?.version || Constants.expoConfig?.version || '?'} />
        {desktop ? <DesktopUpdate /> : null}
        <Info k={t('settings.lightning')} v={backend?.info.label ?? '—'} />
      </Panel>

      <Panel label={t('settings.about')} collapsible defaultOpen={false}>
        <Mono style={styles.dim}>{t('settings.license')}</Mono>
        <Button label={t('settings.source')} variant="ghost" onPress={() => Linking.openURL(SOURCE_URL)} />
      </Panel>

    </Screen>
  );
}

const PIN_LIMITS: Preferences['pinLimit'][] = ['always', '1000', '10000', '100000', 'never'];
const LIMIT_ORDER: Record<Preferences['pinLimit'], number> = { always: 0, '1000': 1, '10000': 2, '100000': 3, never: 4 };

/** Payment PIN limit, screen protection, duress PIN, encrypted backup. */
function SecurityExtras() {
  const styles = useStyles();
  const prefs = usePreferences();
  const { t } = prefs;
  const security = useSecurity();
  const [duressSet, setDuressSet] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      hasDuressPin().then((v) => active && setDuressSet(v), () => {});
      return () => {
        active = false;
      };
    }, []),
  );

  // Loosening a protection needs the PIN; tightening does not.
  const changeLimit = async (next: Preferences['pinLimit']) => {
    if (LIMIT_ORDER[next] > LIMIT_ORDER[prefs.pinLimit] && !(await security.authenticate(t('auth.security')))) return;
    prefs.update({ pinLimit: next });
  };
  const toggleProtection = async () => {
    if (prefs.screenProtection && !(await security.authenticate(t('auth.security')))) return;
    prefs.update({ screenProtection: !prefs.screenProtection });
  };
  const duress = async () => {
    if (!(await security.authenticate(t('auth.security')))) return;
    if (duressSet) {
      await clearDuressPin();
      setDuressSet(false);
    } else {
      router.push({ pathname: '/pin-setup', params: { mode: 'duress' } });
    }
  };

  const limitLabel = (v: Preferences['pinLimit']) =>
    v === 'always' ? t('security.limitAlways') : v === 'never' ? t('security.limitNever') : `≤ ${Number(v).toLocaleString()}`;

  return (
    <>
      <Label style={styles.gap}>{t('security.pinLimit')}</Label>
      <Chips options={PIN_LIMITS.map((v) => ({ value: v, label: limitLabel(v) }))} value={prefs.pinLimit} onChange={changeLimit} />
      <Mono style={styles.dim}>{t('security.pinLimitHint')}</Mono>

      <Info k={t('security.screen')} v={prefs.screenProtection ? t('common.on') : t('common.off')} />
      <Mono style={styles.dim}>{t('security.screenHint')}</Mono>
      <Button
        label={prefs.screenProtection ? t('security.screenOff') : t('security.screenOn')}
        variant="ghost"
        onPress={toggleProtection}
      />

      {!security.decoy && security.pinSet ? (
        <>
          <Info k={t('duress.title')} v={duressSet ? t('common.on') : t('common.off')} />
          <Mono style={styles.dim}>{t('duress.hint')}</Mono>
          <Button label={duressSet ? t('duress.remove') : t('duress.set')} variant="ghost" onPress={duress} />
        </>
      ) : null}

      <Button label={t('backup.title')} variant="ghost" onPress={() => router.push('/backup')} />
    </>
  );
}

function DesktopUpdate() {
  const styles = useStyles();
  const { t } = usePreferences();
  const [state, setState] = useState<'idle' | 'checking' | 'unsupported' | 'done'>('idle');
  const check = async () => {
    setState('checking');
    const result = await desktop?.checkForUpdates().catch(() => null);
    setState(result === null || result === undefined ? 'unsupported' : 'done');
  };
  return (
    <>
      {state === 'unsupported' ? <Mono style={styles.dim}>{t('update.unsupported')}</Mono> : null}
      {state === 'done' ? <Mono style={styles.dim}>{t('update.checked')}</Mono> : null}
      <Button label={t('update.check')} variant="ghost" onPress={check} loading={state === 'checking'} />
    </>
  );
}

function MotionPanel() {
  const styles = useStyles();
  const prefs = usePreferences();
  const { t } = prefs;
  const [note, setNote] = useState<string | null>(null);

  const toggleNotifications = async () => {
    setNote(null);
    if (prefs.notifications) {
      prefs.update({ notifications: false });
      return;
    }
    const granted = await ensureNotificationPermission().catch(() => false);
    if (!granted) setNote(t('notify.denied'));
    prefs.update({ notifications: granted });
  };

  return (
    <Panel label={t('motion.title')} collapsible defaultOpen={false}>
      <Label>{t('motion.animations')}</Label>
      <Segmented
        options={[
          { value: 'auto', label: t('motion.auto') },
          { value: 'on', label: t('common.on') },
          { value: 'off', label: t('common.off') },
        ]}
        value={prefs.motion}
        onChange={(motion) => prefs.update({ motion })}
      />
      <Mono style={styles.dim}>{t('motion.autoHint')}</Mono>
      <Info k={t('motion.scanlines')} v={prefs.scanlines ? t('common.on') : t('common.off')} />
      <Button
        label={prefs.scanlines ? t('motion.scanlinesOff') : t('motion.scanlinesOn')}
        variant="ghost"
        onPress={() => prefs.update({ scanlines: !prefs.scanlines })}
      />
      <Info k={t('motion.haptics')} v={prefs.haptics ? t('common.on') : t('common.off')} />
      <Button
        label={prefs.haptics ? t('motion.hapticsOff') : t('motion.hapticsOn')}
        variant="ghost"
        onPress={() => prefs.update({ haptics: !prefs.haptics })}
      />
      <Info k={t('notify.setting')} v={prefs.notifications ? t('common.on') : t('common.off')} />
      <Mono style={styles.dim}>{backgroundChecksAvailable ? t('notify.hint') : t('notify.hintDesktop')}</Mono>
      {note ? <Mono style={styles.dim}>{`> ${note}`}</Mono> : null}
      <Button
        label={prefs.notifications ? t('notify.disable') : t('notify.enable')}
        variant="ghost"
        onPress={toggleNotifications}
      />
    </Panel>
  );
}

function TorPanel() {
  const styles = useStyles();
  const prefs = usePreferences();
  const { t } = prefs;
  const tor = useTorStatus();

  if (!torAvailable) {
    return (
      <Panel label="tor" collapsible defaultOpen={false}>
        <Mono style={styles.dim}>{t('tor.unavailable')}</Mono>
      </Panel>
    );
  }

  const stateText =
    tor.state === 'on'
      ? t('tor.on')
      : tor.state === 'starting'
        ? t('tor.starting', { progress: tor.progress })
        : tor.state === 'error'
          ? t('tor.error')
          : t('tor.off');

  // Turning it off does not stop a running Tor: onion nodes still need it.
  const toggle = () => prefs.update({ torAll: !prefs.torAll });

  return (
    <Panel label="tor" collapsible defaultOpen={false}>
      <Info k={t('tor.status')} v={stateText} />
      {tor.state === 'starting' ? <ProgressBar progress={tor.progress} /> : null}
      <Info k={t('tor.all')} v={prefs.torAll ? t('common.on') : t('common.off')} />
      <Mono style={styles.dim}>{t('tor.hint')}</Mono>
      {tor.error ? <Mono style={styles.dim}>{`> ${tor.error}`}</Mono> : null}
      <Button
        label={prefs.torAll ? t('tor.disableAll') : t('tor.enableAll')}
        variant="ghost"
        onPress={toggle}
      />
    </Panel>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  const styles = useStyles();
  return (
    <View style={styles.info}>
      <Label>{k}</Label>
      <Mono style={styles.infoValue}>{v}</Mono>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    dim: { color: colors.textDim, fontSize: 12 },
    gap: { marginTop: space.sm },
    info: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    infoValue: { fontSize: 13 },
  }),
);
