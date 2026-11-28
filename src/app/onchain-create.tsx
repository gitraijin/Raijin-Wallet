import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText, Header, Input, Label, Mono, Screen, Segmented } from '@/components/ui';
import { isValidMnemonic, loadMnemonic, replaceMnemonic, seedBytes } from '@/cashu/seed';
import { errorMessage } from '@/lib/format';
import { ONCHAIN_URI } from '@/onchain/backend';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Mode = 'new' | 'restore';

/**
 * Creates the on-chain Bitcoin wallet on this device: keys from the app's
 * 12 recovery words (the same words as Cashu ecash). Existing words are used
 * as they are; otherwise new ones are made, or the user restores old ones.
 */
export default function OnchainCreate() {
  const styles = useStyles();
  const t = useT();
  const { addNode, nodes } = useWallet();
  const [hasSeed, setHasSeed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('new');
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exists = nodes.some((n) => n.kind === 'onchain');

  useEffect(() => {
    loadMnemonic().then((w) => setHasSeed(!!w), () => setHasSeed(false));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'restore' && !hasSeed) await replaceMnemonic(words);
      else await seedBytes(); // creates the 12 words if there are none yet
      await addNode('Bitcoin', ONCHAIN_URI);
      // New words must be written down before money arrives.
      router.replace(mode === 'restore' ? '/' : { pathname: '/cashu-seed', params: { first: '1' } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const wordCount = words.trim() ? words.trim().split(/\s+/).length : 0;
  const ready = mode === 'new' || hasSeed || isValidMnemonic(words);

  return (
    <Screen scroll>
      <Header title={t('onchain.createTitle')} />
      <Mono style={styles.text}>{t('onchain.createIntro')}</Mono>
      {exists ? <Mono style={styles.text}>{t('onchain.exists')}</Mono> : null}
      {hasSeed ? (
        <Mono style={styles.text}>{t('onchain.useExistingSeed')}</Mono>
      ) : hasSeed === false ? (
        <>
          <Segmented<Mode>
            options={[
              { value: 'new', label: t('onchain.new') },
              { value: 'restore', label: t('onchain.restore') },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'restore' ? (
            <View style={styles.block}>
              <Label>{t('seed.words')}</Label>
              <Input value={words} onChangeText={setWords} multiline placeholder="word1 word2 … word12" autoComplete="off" />
              <Mono style={styles.text}>{isValidMnemonic(words) ? t('seed.valid') : t('seed.invalid', { count: wordCount })}</Mono>
              <Mono style={styles.text}>{t('onchain.restoreHint')}</Mono>
            </View>
          ) : (
            <Mono style={styles.text}>{t('onchain.newHint')}</Mono>
          )}
        </>
      ) : null}
      <Mono style={styles.text}>{t('onchain.serverHint')}</Mono>
      <ErrorText>{error}</ErrorText>
      <Button label={t('onchain.create')} onPress={create} loading={busy} disabled={!ready || exists || hasSeed === null} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    text: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
    block: { gap: space.sm },
  }),
);
