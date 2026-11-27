import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { hostOf, inspectMint, type MintPreview } from '@/cashu/wallet';
import { Button, ErrorText, Header, InfoRow, Input, Label, Mono, Panel, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { useSecurity } from '@/security/SecurityContext';
import { makeStyles, space } from '@/theme';
import { confirmAction } from '@/lib/confirm';

/** Add, inspect and remove mints. */
export default function CashuMints() {
  const styles = useStyles();
  const { t } = usePreferences();
  const amount = useAmount();
  const security = useSecurity();
  const { mints, balances, addMint, removeMint } = useCashu();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<MintPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await inspectMint(url));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!preview) return;
    await addMint(preview);
    setPreview(null);
    setUrl('');
  };

  const confirmRemove = async (id: string, name: string, balance: bigint) => {
    const body = balance > 0n ? t('cashu.removeWithBalance', { amount: amount.format(balance) }) : t('cashu.removeBody');
    if (!(await confirmAction(t('cashu.removeTitle', { name }), body, t('cashu.removeMint'), t('common.cancel')))) return;
    if (balance > 0n && !(await security.authenticate(t('cashu.removeMint')))) return;
    await removeMint(id);
  };

  return (
    <Screen scroll>
      <Header title={t('cashu.mints')} />

      <Panel label={t('cashu.addMint')}>
        <Mono style={styles.hint}>{t('cashu.mintHelp')}</Mono>
        <Input
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setPreview(null);
          }}
          placeholder="https://mint.example.com"
          keyboardType="url"
        />
        <ErrorText>{error}</ErrorText>
        {preview ? (
          <View style={styles.block}>
            <InfoRow k={t('cashu.mintName')} v={preview.name} strong />
            <InfoRow k="url" v={hostOf(preview.url)} />
            {preview.description ? <Mono style={styles.hint}>{preview.description}</Mono> : null}
            <Mono style={styles.hint}>{t('cashu.trustNote')}</Mono>
            <Button label={t('cashu.addMint')} onPress={add} />
          </View>
        ) : (
          <Button label={t('cashu.checkMint')} onPress={check} loading={busy} disabled={url.trim() === ''} />
        )}
      </Panel>

      {mints.length > 0 ? <Label>{t('cashu.mints')}</Label> : null}
      {mints.map((mint) => {
        const balance = balances[mint.id] ?? 0n;
        return (
          <Panel key={mint.id} label={mint.name}>
            <InfoRow k="url" v={hostOf(mint.url)} />
            <InfoRow k={t('cashu.balance')} v={amount.format(balance)} />
            <Button
              label={t('cashu.removeMint')}
              variant="danger"
              onPress={() => confirmRemove(mint.id, mint.name, balance)}
            />
          </Panel>
        );
      })}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
