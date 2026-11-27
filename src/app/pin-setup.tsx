import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PinPad } from '@/components/PinPad';
import { Button, ErrorText, Header, Mono, Screen } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { PIN_LENGTH, setDuressPin } from '@/security/pin';
import { useSecurity } from '@/security/SecurityContext';
import { makeStyles, space } from '@/theme';

type Step = 'enter' | 'confirm' | 'biometrics';

/**
 * Sets the app PIN (mandatory after wallet setup) or changes it
 * (`?mode=change`, reached from settings after re-authentication).
 */
export default function PinSetup() {
  const styles = useStyles();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const duressMode = mode === 'duress';
  const changing = mode === 'change' || duressMode;
  const { savePin, biometricsAvailable, biometricsEnabled, setBiometrics } = useSecurity();
  const t = useT();

  const [step, setStep] = useState<Step>('enter');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reshuffle, setReshuffle] = useState(0);

  const finish = () => {
    if (changing) router.back();
    else router.replace('/');
  };

  const onComplete = async (pin: string) => {
    if (step === 'enter') {
      setFirst(pin);
      setError(null);
      setStep('confirm');
      setReshuffle((n) => n + 1);
      return;
    }
    if (pin !== first) {
      setError(t('pin.mismatch'));
      setFirst('');
      setStep('enter');
      setReshuffle((n) => n + 1);
      return;
    }
    try {
      if (duressMode) {
        await setDuressPin(pin);
        finish();
        return;
      }
      await savePin(pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (biometricsAvailable && !biometricsEnabled) setStep('biometrics');
    else finish();
  };

  const enableBiometrics = async () => {
    const ok = await setBiometrics(true);
    if (ok) finish();
    else setError(t('pin.bioNotConfirmed'));
  };

  if (step === 'biometrics') {
    return (
      <Screen>
        <Header title={t('pin.security')} back={false} />
        <View style={styles.center}>
          <Mono style={styles.title}>{t('pin.bioTitle')}</Mono>
          <Mono style={styles.hint}>
            {t('pin.bioHint')}
          </Mono>
          <ErrorText>{error}</ErrorText>
        </View>
        <Button label={t('pin.enableBio')} onPress={enableBiometrics} />
        <Button label={t('pin.notNow')} variant="ghost" onPress={finish} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title={duressMode ? t('duress.title') : changing ? t('pin.titleChange') : t('pin.titleSet')}
        back={changing}
      />
      <View style={styles.center}>
        <Mono style={styles.title}>
          {step === 'enter' ? t('pin.choose', { n: PIN_LENGTH }) : t('pin.repeat')}
        </Mono>
        {step === 'enter' && !changing ? (
          <Mono style={styles.hint}>{t('pin.hint')}</Mono>
        ) : null}
        {step === 'enter' && duressMode ? <Mono style={styles.hint}>{t('duress.setupHint')}</Mono> : null}
        <ErrorText>{error}</ErrorText>
        <PinPad key={reshuffle} length={PIN_LENGTH} onComplete={onComplete} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
    title: { color: colors.text, fontSize: 15 },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  }),
);
