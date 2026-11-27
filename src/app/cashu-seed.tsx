import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { isValidMnemonic, loadMnemonic, markBackedUp, replaceMnemonic, seedBytes } from '@/cashu/seed';
import { hostOf, inspectMint, resetWallets, restoreFromMint, type RestoreResult } from '@/cashu/wallet';
import { Button, ErrorText, Header, Input, Label, Mono, Panel, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { ProgressBar } from '@/motion/ProgressBar';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { useSensitiveScreen } from '@/security/PrivacyGuard';
import { useSecurity } from '@/security/SecurityContext';
import { fonts, makeStyles, space, useTheme } from '@/theme';

type Tab = 'backup' | 'restore';

/** Cashu recovery words: show them (behind the PIN) or restore ecash from them. */
export default function CashuSeed() {
  const { t } = usePreferences();
  const [tab, setTab] = useState<Tab>('backup');
  return (
    <Screen scroll>
      <Header title={t('seed.title')} />
      <Segmented<Tab>
        options={[
          { value: 'backup', label: t('seed.backup') },
          { value: 'restore', label: t('seed.restore') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'backup' ? <Backup /> : <Restore />}
    </Screen>
  );
}

function Backup() {
  useSensitiveScreen();
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const security = useSecurity();
  const { reload } = useCashu();
  const [words, setWords] = useState<string[] | null>(null);

  const reveal = async () => {
    if (!(await security.authenticate(t('seed.reveal')))) return;
    await seedBytes(); // creates the seed if Cashu was never used
    setWords(((await loadMnemonic()) ?? '').split(' '));
  };

  if (!words) {
    return (
      <View style={styles.block}>
        <Mono style={styles.hint}>{t('seed.intro')}</Mono>
        <Mono style={[styles.hint, { color: colors.accent }]}>{t('seed.scope')}</Mono>
        <Button label={t('seed.reveal')} onPress={reveal} />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Mono style={[styles.hint, { color: colors.danger }]}>{t('seed.warning')}</Mono>
      <View style={styles.grid}>
        {words.map((word, i) => (
          <View key={i} style={styles.word}>
            <Mono style={styles.index}>{String(i + 1).padStart(2, '0')}</Mono>
            <Mono style={styles.wordText}>{word}</Mono>
          </View>
        ))}
      </View>
      <Button
        label={t('seed.written')}
        onPress={async () => {
          await markBackedUp();
          await reload();
          router.back();
        }}
      />
    </View>
  );
}

function Restore() {
  const styles = useStyles();
  const { t } = usePreferences();
  const amount = useAmount();
  const security = useSecurity();
  const { mints, addMint, reload } = useCashu();
  const [words, setWords] = useState('');
  const [extraMint, setExtraMint] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<RestoreResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidMnemonic(words);
  const wordCount = words.trim() ? words.trim().split(/\s+/).length : 0;

  const run = async () => {
    if (!(await security.authenticate(t('seed.restore')))) return;
    setError(null);
    setResults(null);
    try {
      const current = await loadMnemonic();
      if (!current || current !== words.trim().toLowerCase().split(/\s+/).join(' ')) {
        await replaceMnemonic(words);
        resetWallets();
      }
      const targets = [...mints];
      if (extraMint.trim()) targets.push(await addMint(await inspectMint(extraMint)));
      const done: RestoreResult[] = [];
      setProgress(0);
      for (const [i, mint] of targets.entries()) {
        try {
          done.push(
            await restoreFromMint(mint, (fraction) => setProgress(((i + fraction) / targets.length) * 100)),
          );
        } catch (e) {
          setError(`${hostOf(mint.url)}: ${errorMessage(e)}`);
        }
        setProgress(((i + 1) / targets.length) * 100);
      }
      setResults(done);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.block}>
      <Mono style={styles.hint}>{t('seed.restoreIntro')}</Mono>
      <Label>{t('seed.words')}</Label>
      <Input value={words} onChangeText={setWords} multiline placeholder="word1 word2 … word12" autoComplete="off" />
      <Mono style={styles.hint}>
        {wordCount > 0 ? (valid ? t('seed.valid') : t('seed.invalid', { count: wordCount })) : ''}
      </Mono>
      <Label>{t('seed.mints')}</Label>
      {mints.map((m) => (
        <Mono key={m.id} style={styles.hint}>{`· ${m.name} (${hostOf(m.url)})`}</Mono>
      ))}
      <Input value={extraMint} onChangeText={setExtraMint} placeholder={t('seed.extraMint')} keyboardType="url" />
      {progress !== null ? <ProgressBar progress={progress} label={t('seed.restoring')} /> : null}
      <ErrorText>{error}</ErrorText>
      {results ? (
        <Panel label={t('seed.result')}>
          {results.map((r) => (
            <Mono key={r.url}>{`${hostOf(r.url)}: ${amount.format(r.amountSats)} (${r.proofs})`}</Mono>
          ))}
        </Panel>
      ) : null}
      <Button
        label={t('seed.restoreRun')}
        onPress={run}
        loading={progress !== null}
        disabled={!valid || (mints.length === 0 && !extraMint.trim())}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    word: {
      width: '31%',
      flexDirection: 'row',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: 8,
      paddingHorizontal: 8,
    },
    index: { color: colors.textFaint, fontSize: 11 },
    wordText: { fontFamily: fonts.bold, fontSize: 13 },
  }),
);
