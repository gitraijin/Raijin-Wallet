import { router } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { Logo } from '@/components/brand';
import { Button, Label, Mono, Screen } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space } from '@/theme';

export default function Onboarding() {
  const styles = useStyles();
  const t = useT();
  return (
    <Screen>
      <View style={styles.hero}>
        <Logo />
        <View style={styles.notes}>
          <Mono style={styles.note}>{t('onboarding.note1')}</Mono>
          <Mono style={styles.note}>{t('onboarding.note2')}</Mono>
          <Mono style={styles.note}>{t('onboarding.note3')}</Mono>
          <Mono style={styles.note}>{t('onboarding.note4')}</Mono>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label={t('onboarding.createOnchain')} onPress={() => router.push('/onchain-create')} />
        <Button label={t('onboarding.connect')} variant="secondary" onPress={() => router.push('/connect')} />
        <Label style={styles.network}>{t('onboarding.footer')}</Label>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: { flex: 1, justifyContent: 'center', gap: space.xl },
    notes: { gap: space.sm },
    note: { color: colors.textDim, fontSize: 13 },
    actions: { gap: space.md },
    network: { textAlign: 'center', marginTop: space.sm },
  }),
);
