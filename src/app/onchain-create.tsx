import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText, Header, Input, Label, Mono, Screen, Segmented } from '@/components/ui';
import { isBackedUp, loadMnemonic, seedBytes } from '@/cashu/seed';
import { errorMessage } from '@/lib/format';
import { loadNodeUri } from '@/lib/nodes';
import { createOwn, forgetOwn, newWords, ownUri, parseOnchainUri, sharedUri, validWords } from '@/onchain/keys';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Source = 'shared' | 'own';
type Mode = 'new' | 'restore';

/**
 * Adds a Bitcoin (on-chain) wallet. Keys either from the app's shared words
 * (with Cashu; every further wallet is the next BIP84 account) or from the
 * wallet's own 12 or 24 words with an optional passphrase, only for Bitcoin.
 */
export default function OnchainCreate() {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const { addNode, nodes } = useWallet();
  const [hasShared, setHasShared] = useState<boolean | null>(null);
  const [nextAccount, setNextAccount] = useState(0);
  const [source, setSource] = useState<Source>('shared');
  const [mode, setMode] = useState<Mode>('new');
  const [count, setCount] = useState<'12' | '24'>('24');
  const [words, setWords] = useState('');
  const [usePass, setUsePass] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which shared account comes next (every on-chain wallet on the shared words has its own).
  useEffect(() => {
    let alive = true;
    (async () => {
      const w = await loadMnemonic();
      let max = -1;
      for (const n of nodes.filter((x) => x.kind === 'onchain')) {
        const uri = await loadNodeUri(n.id);
        try {
          const keys = uri ? parseOnchainUri(uri) : null;
          if (keys?.kind === 'shared') max = Math.max(max, keys.account);
        } catch {
          // other kinds
        }
      }
      if (alive) {
        setHasShared(!!w);
        setNextAccount(max + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [nodes]);

  const defaultName = source === 'own' ? t('onchain.nameOwn') : nextAccount === 0 ? 'Bitcoin' : `Bitcoin ${nextAccount + 1}`;
  const passOk = !usePass || (pass.length > 0 && pass === pass2);
  const wordCount = words.trim() ? words.trim().split(/\s+/).length : 0;
  const ready = source === 'shared' ? hasShared !== null : passOk && (mode === 'new' || validWords(words));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (source === 'shared') {
        await seedBytes(); // creates the shared words if there are none yet
        const backedUp = await isBackedUp();
        await addNode(name.trim() || defaultName, sharedUri(nextAccount));
        router.replace(backedUp ? '/' : { pathname: '/cashu-seed', params: { first: '1' } });
        return;
      }
      const restored = mode === 'restore';
      const id = await createOwn(restored ? words : newWords(count === '24' ? 24 : 12), usePass ? pass : '', restored);
      try {
        await addNode(name.trim() || defaultName, ownUri(id));
      } catch (e) {
        await forgetOwn(id); // nothing left behind when the server check fails
        throw e;
      }
      router.replace(restored ? '/' : { pathname: '/onchain-words', params: { own: id, first: '1' } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title={t('onchain.createTitle')} />
      <Mono style={styles.text}>{t('onchain.createIntro')}</Mono>

      <Label>{t('onchain.keys')}</Label>
      <Segmented<Source>
        options={[
          { value: 'shared', label: t('onchain.keysShared') },
          { value: 'own', label: t('onchain.keysOwn') },
        ]}
        value={source}
        onChange={setSource}
      />

      {source === 'shared' ? (
        <>
          <Mono style={styles.text}>{hasShared ? t('onchain.useExistingSeed') : t('onchain.sharedNew')}</Mono>
          {nextAccount > 0 ? <Mono style={styles.text}>{t('onchain.nextAccount', { n: nextAccount + 1 })}</Mono> : null}
        </>
      ) : (
        <>
          <Mono style={styles.text}>{t('onchain.ownIntro')}</Mono>
          <Segmented<Mode>
            options={[
              { value: 'new', label: t('onchain.new') },
              { value: 'restore', label: t('onchain.restore') },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'new' ? (
            <>
              <Label>{t('onchain.wordCount')}</Label>
              <Segmented<'12' | '24'>
                options={[
                  { value: '12', label: t('onchain.words12') },
                  { value: '24', label: t('onchain.words24') },
                ]}
                value={count}
                onChange={setCount}
              />
            </>
          ) : (
            <View style={styles.block}>
              <Label>{t('onchain.wordsField')}</Label>
              <Input value={words} onChangeText={setWords} multiline placeholder="word1 word2 …" autoComplete="off" autoCapitalize="none" />
              <Mono style={styles.text}>{validWords(words) ? t('seed.valid') : t('seed.invalid', { count: wordCount })}</Mono>
              <Mono style={styles.text}>{t('onchain.restoreHint')}</Mono>
            </View>
          )}

          <Label>{t('onchain.passphrase')}</Label>
          <Segmented<'off' | 'on'>
            options={[
              { value: 'off', label: t('onchain.passOff') },
              { value: 'on', label: t('onchain.passOn') },
            ]}
            value={usePass ? 'on' : 'off'}
            onChange={(v) => setUsePass(v === 'on')}
          />
          {usePass ? (
            <View style={styles.block}>
              <Input value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoComplete="off" placeholder={t('onchain.passphrase')} />
              <Input value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" autoComplete="off" placeholder={t('onchain.passRepeat')} />
              {pass2 && pass !== pass2 ? <ErrorText>{t('onchain.passMismatch')}</ErrorText> : null}
              <Mono style={[styles.text, { color: colors.danger }]}>{t('onchain.passWarning')}</Mono>
            </View>
          ) : null}
        </>
      )}

      <Label>{t('onchain.name')}</Label>
      <Input value={name} onChangeText={setName} placeholder={defaultName} maxLength={40} />
      <Mono style={styles.text}>{t('onchain.serverHint')}</Mono>
      <Button label={t('privacy.button')} variant="ghost" onPress={() => router.push('/privacy')} />
      <ErrorText>{error}</ErrorText>
      <Button label={t('onchain.create')} onPress={create} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    text: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
    block: { gap: space.sm },
  }),
);
