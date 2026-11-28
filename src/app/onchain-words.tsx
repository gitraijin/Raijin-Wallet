import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Header, Mono, Screen } from '@/components/ui';
import { loadNodeUri } from '@/lib/nodes';
import { markOwnBackedUp, ownWords, parseOnchainUri } from '@/onchain/keys';
import { useT } from '@/preferences/PreferencesContext';
import { useSensitiveScreen } from '@/security/PrivacyGuard';
import { useSecurity } from '@/security/SecurityContext';
import { fonts, makeStyles, space, useTheme } from '@/theme';

/** Shows the own recovery words of an on-chain wallet (?own=<id> or ?node=<node id>). */
export default function OnchainWords() {
  useSensitiveScreen();
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const security = useSecurity();
  const params = useLocalSearchParams<{ own?: string; node?: string; first?: string }>();
  const [id, setId] = useState<string | null>(params.own ?? null);
  const [shown, setShown] = useState<{ words: string[]; hasPassphrase: boolean } | null>(null);

  useEffect(() => {
    if (id || !params.node) return;
    loadNodeUri(params.node).then((uri) => {
      try {
        const keys = uri ? parseOnchainUri(uri) : null;
        if (keys?.kind === 'own') setId(keys.id);
      } catch {
        // not an own-words wallet
      }
    });
  }, [id, params.node]);

  const reveal = async () => {
    if (!id || !(await security.authenticate(t('seed.reveal')))) return;
    const w = await ownWords(id);
    if (w) setShown({ words: w.words.split(' '), hasPassphrase: w.hasPassphrase });
  };

  return (
    <Screen scroll>
      <Header title={t('onchain.wordsTitle')} />
      {!shown ? (
        <View style={styles.block}>
          <Mono style={styles.hint}>{params.first ? t('onchain.wordsFirst') : t('onchain.wordsIntro')}</Mono>
          <Button label={t('seed.reveal')} onPress={reveal} disabled={!id} />
        </View>
      ) : (
        <View style={styles.block}>
          <Mono style={[styles.hint, { color: colors.danger }]}>{t('onchain.wordsWarning')}</Mono>
          <View style={styles.grid}>
            {shown.words.map((word, i) => (
              <View key={i} style={styles.word}>
                <Mono style={styles.index}>{String(i + 1).padStart(2, '0')}</Mono>
                <Mono style={styles.wordText}>{word}</Mono>
              </View>
            ))}
          </View>
          {shown.hasPassphrase ? <Mono style={[styles.hint, { color: colors.accent }]}>{t('onchain.wordsPassphrase')}</Mono> : null}
          <Button
            label={t('seed.written')}
            onPress={async () => {
              if (id) await markOwnBackedUp(id);
              router.replace('/');
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    hint: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    word: { width: '31%', flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: 8, paddingHorizontal: 8 },
    index: { color: colors.textFaint, fontSize: 11 },
    wordText: { fontFamily: fonts.bold, fontSize: 13 },
  }),
);
