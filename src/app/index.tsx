import { Redirect, router } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { Logo } from '@/components/brand';
import { Button, ErrorText, Mono, Screen } from '@/components/ui';
import { makeStyles, space, useTheme } from '@/theme';
import { useT } from '@/preferences/PreferencesContext';
import { useSecurity } from '@/security/SecurityContext';
import { useTorStatus } from '@/net/tor';
import { useWallet } from '@/wallet/WalletContext';
import { ProgressBar } from '@/motion/ProgressBar';
import { TypeLine } from '@/motion/TypeLine';

/** Entry gate: routes to onboarding or home depending on wallet state. */
export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { status, error, retry, activeNode } = useWallet();
  const { pinSet } = useSecurity();
  const t = useT();
  const tor = useTorStatus();

  if (status === 'empty') return <Redirect href="/onboarding" />;
  // Every wallet needs an app PIN, also wallets set up before PINs existed.
  if (status === 'ready' && !pinSet) return <Redirect href="/pin-setup" />;
  if (status === 'ready') return <Redirect href="/home" />;

  return (
    <Screen>
      <View style={styles.center}>
        <Logo />
        {status === 'error' ? (
          <View style={styles.block}>
            <Mono style={{ color: colors.danger }}>{t('boot.failed')}</Mono>
            <ErrorText>{error}</ErrorText>
            <Button label={t('common.retry')} variant="secondary" onPress={retry} />
            <Button label={t('nodes.manage')} variant="ghost" onPress={() => router.push('/nodes')} />
          </View>
        ) : (
          <View style={styles.block}>
            {status === 'connecting' && tor.state === 'starting' ? (
              <ProgressBar progress={tor.progress} label={t('boot.tor')} />
            ) : (
              <TypeLine
                style={styles.dim}
                text={status === 'connecting' && activeNode ? t('boot.node', { name: activeNode.name }) : t('boot.keystore')}
              />
            )}
            <ActivityIndicator color={colors.accent} style={styles.spinner} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', gap: space.xl },
    block: { gap: space.md },
    dim: { color: colors.textDim, fontSize: 12 },
    spinner: { alignSelf: 'flex-start' },
  }),
);
