import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Button, Mono } from '@/components/ui';
import { cancelNfcRead, nfcNeedsButton, nfcState, openNfcSettings, readNfcTag, type NfcState } from '@/lib/nfc';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, useTheme } from '@/theme';

/**
 * NFC next to the camera on the scan screen. On Android it listens while the
 * screen is focused; on iOS a button opens the system NFC sheet. `onTag`
 * gets the texts of each tag and returns true once it handled one.
 */
export function NfcReader({ onTag }: { onTag: (texts: string[]) => boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const [state, setState] = useState<NfcState | null>(null);
  const [focused, setFocused] = useState(false);
  const onTagRef = useRef(onTag);
  useEffect(() => {
    onTagRef.current = onTag;
  });

  // NFC may be switched on in the system settings while we wait.
  useEffect(() => {
    const check = () => void nfcState().then(setState);
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Android: keep listening, one tag after another, until one is used.
  useEffect(() => {
    if (nfcNeedsButton || state !== 'ready' || !focused) return;
    let active = true;
    (async () => {
      while (active) {
        try {
          const texts = await readNfcTag(t('nfc.alert'));
          if (active && onTagRef.current(texts)) return;
        } catch {
          if (!active) return;
          await new Promise((r) => setTimeout(r, 500)); // cancelled or tag lost: listen again
        }
      }
    })();
    return () => {
      active = false;
      cancelNfcRead();
    };
  }, [state, focused, t]);

  const readOnce = async () => {
    try {
      onTagRef.current(await readNfcTag(t('nfc.alert')));
    } catch {
      // cancelled in the system sheet
    }
  };

  if (state === null || state === 'unsupported') return null;
  if (state === 'off') {
    return (
      <View style={styles.box}>
        <Mono style={styles.dim}>{t('nfc.off')}</Mono>
        <Button label={t('nfc.settings')} variant="ghost" onPress={openNfcSettings} />
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <Mono style={[styles.dim, { color: colors.accent }]}>{nfcNeedsButton ? t('nfc.hintButton') : t('nfc.hint')}</Mono>
      {nfcNeedsButton ? <Button label={t('nfc.read')} variant="secondary" onPress={readOnce} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    box: { gap: 8 },
    dim: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
