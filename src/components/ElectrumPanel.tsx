import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ErrorText, Input, Label, Mono, Panel } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { DEFAULT_SERVERS, getCustomServer, parseServer, serverLabel, setCustomServer } from '@/onchain/electrum';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

/** Settings → Bitcoin server: the user's own Electrum server (tried first), and the fallbacks. */
export function ElectrumPanel() {
  const styles = useStyles();
  const t = useT();
  const { nodes, activeNode, retry } = useWallet();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCustomServer().then((s) => {
      const v = s ? serverLabel(s) : '';
      setValue(v);
      setSaved(v);
    });
  }, []);

  if (!nodes.some((n) => n.kind === 'onchain')) return null;

  const save = async (next: string | null) => {
    setError(null);
    try {
      await setCustomServer(next);
      setSaved(next ?? '');
      if (!next) setValue('');
      // Reconnect the on-chain wallet to the new server.
      if (activeNode?.kind === 'onchain') void retry();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Panel label={t('electrum.title')} collapsible defaultOpen={false}>
      <Mono style={styles.hint}>{t('electrum.intro')}</Mono>
      <Label>{t('electrum.own')}</Label>
      <Input value={value} onChangeText={setValue} placeholder="ssl://node.local:50002" autoCapitalize="none" autoCorrect={false} />
      {value.trim() && !parseServer(value) ? <ErrorText>{t('electrum.invalid')}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      {value.trim() !== saved ? <Button label={t('common.save')} variant="secondary" disabled={!!value.trim() && !parseServer(value)} onPress={() => save(value.trim() || null)} /> : null}
      {saved ? <Button label={t('electrum.useDefault')} variant="ghost" onPress={() => save(null)} /> : null}
      <Mono style={styles.hint}>{`${t('electrum.fallbacks')}\n${DEFAULT_SERVERS.map(serverLabel).join('\n')}`}</Mono>
    </Panel>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
