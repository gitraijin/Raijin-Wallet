import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/brand';
import { PinPad } from '@/components/PinPad';
import { Button, ErrorText, Mono } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { lockoutRemainingMs, PIN_LENGTH, verifyPin } from '@/security/pin';
import { type AuthRequest, useSecurity } from '@/security/SecurityContext';
import { makeStyles, space } from '@/theme';

/** Full-screen PIN / biometrics prompt for the app lock and sensitive actions. */
export function LockOverlay() {
  const { request } = useSecurity();
  if (!request) return null;
  // A fresh prompt per request: new key layout, cleared input and error.
  return <LockPrompt key={request.id} request={request} />;
}

function LockPrompt({ request }: { request: AuthRequest }) {
  const styles = useStyles();
  const { biometricsEnabled, promptBiometrics, resolveRequest, decoy, unlockedWith } = useSecurity();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [lockedMs, setLockedMs] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const message = request.mode === 'confirm' ? request.reason : t('auth.unlock');

  const tryBiometrics = useCallback(async () => {
    if (!biometricsEnabled) return;
    if (await promptBiometrics(message)) {
      // Biometrics always mean the owner: back to the real wallet.
      if (request.mode === 'unlock') unlockedWith(false);
      resolveRequest(true);
    }
  }, [biometricsEnabled, promptBiometrics, resolveRequest, message, request.mode, unlockedWith]);

  // On appearance: restore a running lockout and offer biometrics right away.
  useEffect(() => {
    lockoutRemainingMs().then(setLockedMs);
    void tryBiometrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per prompt
  }, []);

  // Lockout countdown.
  const locked = lockedMs > 0;
  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setLockedMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const onComplete = async (pin: string) => {
    setBusy(true);
    const result = await verifyPin(pin);
    setBusy(false);
    // In the real wallet the duress PIN never confirms a payment.
    const accepted = result.ok && (request.mode === 'unlock' || !result.duress || decoy);
    if (result.ok && accepted) {
      if (request.mode === 'unlock') unlockedWith(result.duress);
      resolveRequest(true);
      return;
    }
    if (result.ok) {
      setAttempt((n) => n + 1);
      setError(t('lock.wrong'));
      return;
    }
    setAttempt((n) => n + 1); // remount the pad: reshuffled, cleared
    setLockedMs(result.lockedForMs);
    setError(result.lockedForMs > 0 ? t('lock.tooMany') : t('lock.wrong'));
  };

  return (
    <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Logo tagline={false} />
        <Mono style={styles.message}>{`> ${message.toLowerCase()}`}</Mono>
      </View>
      <View style={styles.middle}>
        {locked ? (
          <Mono style={styles.message}>{t('lock.locked', { s: Math.ceil(lockedMs / 1000) })}</Mono>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <PinPad
          key={attempt}
          length={PIN_LENGTH}
          onComplete={onComplete}
          onBiometrics={biometricsEnabled ? tryBiometrics : undefined}
          disabled={locked || busy}
        />
      </View>
      {request.mode === 'confirm' ? (
        <Button label={t('common.cancel')} variant="ghost" onPress={() => resolveRequest(false)} />
      ) : null}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.bg,
      padding: space.md,
      gap: space.lg,
      zIndex: 100,
      elevation: 100,
    },
    top: { gap: space.md, marginTop: space.lg },
    middle: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
    message: { color: colors.textDim, fontSize: 12 },
  }),
);
