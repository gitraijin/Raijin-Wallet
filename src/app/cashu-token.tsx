import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { reclaimToken, reconcile } from '@/cashu/wallet';
import { QrBlock } from '@/components/QrBlock';
import { Button, ErrorText, Header, Label, Mono, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { makeStyles, useTheme } from '@/theme';

/** A sent token: show it again, check whether it was claimed, or take it back. */
export default function CashuToken() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const btc = useAmount();
  const { entry: entryId } = useLocalSearchParams<{ entry: string }>();
  const { history, mintById, reload } = useCashu();
  const [busy, setBusy] = useState<'check' | 'reclaim' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entry = history.find((e) => e.id === entryId);
  const mint = entry ? mintById(entry.mintId) : undefined;

  const run = async (kind: 'check' | 'reclaim') => {
    if (!entry || !mint) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'reclaim') await reclaimToken(mint, entry);
      else await reconcile(mint);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await reload();
      setBusy(null);
    }
  };

  if (!entry || !mint) {
    return (
      <Screen>
        <Header title={t('cashu.token')} />
        <Mono style={styles.hint}>{t('cashu.tokenGone')}</Mono>
      </Screen>
    );
  }

  const sats = BigInt(entry.amount);
  return (
    <Screen scroll>
      <Header title={t('cashu.token')} />
      <Label>{`${mint.name} // ${btc.format(sats)}${entry.memo ? ` // ${entry.memo}` : ''}`}</Label>
      {entry.state === 'pending' && entry.token ? (
        <>
          <Mono style={styles.hint}>{t('cashu.tokenHint')}</Mono>
          <QrBlock value={entry.token} uri={`cashu:${entry.token}`} />
          <Button label={t('cashu.checkClaimed')} variant="ghost" onPress={() => run('check')} loading={busy === 'check'} />
          <Button
            label={t('cashu.reclaim')}
            variant="danger"
            onPress={() => run('reclaim')}
            loading={busy === 'reclaim'}
            disabled={busy !== null}
          />
        </>
      ) : (
        <Mono style={{ color: entry.state === 'complete' ? colors.success : colors.textDim }}>
          {entry.state === 'complete' ? t('cashu.tokenClaimed') : t('cashu.tokenReclaimed')}
        </Mono>
      )}
      <ErrorText>{error}</ErrorText>
      <Button label={t('common.done')} onPress={() => router.back()} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
