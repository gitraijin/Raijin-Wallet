import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';

import { Button, ErrorText, Header, Input, Label, Mono, Panel, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { goHome } from '@/lib/navigation';
import { loadNodeUri } from '@/lib/nodes';
import type { ConnectionKind } from '@/lightning/connection';
import { useT } from '@/preferences/PreferencesContext';
import { useSecurity } from '@/security/SecurityContext';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { type NodeEntry, useWallet } from '@/wallet/WalletContext';
import { confirmAction } from '@/lib/confirm';

const KIND_LABEL: Record<ConnectionKind, string> = {
  lnd: 'LND REST',
  nwc: 'NWC',
  lndhub: 'LNDHUB',
  onchain: 'ON-CHAIN',
};

/** Saved nodes: switch, rename, remove, add. */
export default function Nodes() {
  const { nodes, activeNodeId } = useWallet();
  const t = useT();

  return (
    <Screen scroll>
      <Header title={t('nodes.title')} />
      {nodes.map((node) => (
        <NodeCard key={node.id} node={node} active={node.id === activeNodeId} />
      ))}
      <Button label={t('nodes.add')} onPress={() => router.push('/connect')} />
      <Button label={t('onboarding.createOnchain')} variant="secondary" onPress={() => router.push('/onchain-create')} />
    </Screen>
  );
}

function NodeCard({ node, active }: { node: NodeEntry; active: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { switchNode, renameNode, removeNode, status } = useWallet();
  const security = useSecurity();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [error, setError] = useState<string | null>(null);
  // On-chain wallets: which words they use (own words are shown and deleted with the wallet).
  const [ownWords, setOwnWords] = useState(false);
  useEffect(() => {
    if (node.kind !== 'onchain') return;
    loadNodeUri(node.id).then((uri) => setOwnWords(!!uri?.toLowerCase().startsWith('raijin-onchain://own/')));
  }, [node.id, node.kind]);

  const select = () => {
    if (active && status === 'ready') {
      router.back();
      return;
    }
    void switchNode(node.id);
    goHome();
  };

  const saveName = async () => {
    setError(null);
    try {
      await renameNode(node.id, name);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const confirmRemove = async () => {
    const confirmed = await confirmAction(
      t('nodes.removeTitle', { name: node.name }),
      ownWords ? `${t('nodes.removeBody')}\n\n${t('onchain.removeOwnWarning')}` : t('nodes.removeBody'),
      t('nodes.remove'),
      t('common.cancel'),
    );
    if (!confirmed || !(await security.authenticate(t('nodes.remove')))) return;
    try {
      const remaining = await removeNode(node.id);
      if (remaining === 0) {
        // Last node gone: back to a clean device, including the app PIN.
        await security.reset();
        goHome();
      } else if (active) {
        goHome();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Panel
      label={KIND_LABEL[node.kind]}
      accent={active ? colors.primary : colors.border}
      right={active ? <Mono style={styles.active}>{t('nodes.activeTag')}</Mono> : undefined}>
      {editing ? (
        <View style={styles.field}>
          <Label>{t('connect.name')}</Label>
          <Input value={name} onChangeText={setName} maxLength={40} autoFocus />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                label={t('common.cancel')}
                variant="ghost"
                onPress={() => {
                  setName(node.name);
                  setEditing(false);
                }}
              />
            </View>
            <View style={styles.flex}>
              <Button label={t('nodes.save')} onPress={saveName} disabled={name.trim() === ''} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <Pressable
            onPress={select}
            accessibilityRole="button"
            accessibilityLabel={t('nodes.use', { name: node.name })}>
            <Mono style={styles.name} numberOfLines={1}>
              {active ? `> ${node.name}` : node.name}
            </Mono>
            {!active ? <Mono style={styles.hint}>{t('nodes.tapToUse')}</Mono> : null}
          </Pressable>
          {node.kind === 'onchain' ? (
            <Button
              label={t('onchain.showWords')}
              variant="ghost"
              onPress={() => router.push(ownWords ? { pathname: '/onchain-words', params: { node: node.id } } : '/cashu-seed')}
            />
          ) : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label={t('nodes.rename')} variant="ghost" onPress={() => setEditing(true)} />
            </View>
            <View style={styles.flex}>
              <Button label={t('nodes.remove')} variant="danger" onPress={confirmRemove} />
            </View>
          </View>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
    hint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
    active: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1.5, color: colors.primary },
    field: { gap: space.xs },
    row: { flexDirection: 'row', gap: space.sm },
    flex: { flex: 1 },
  }),
);
