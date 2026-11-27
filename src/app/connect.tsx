import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { Button, ErrorText, Header, Input, Label, Mono, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { goHome } from '@/lib/navigation';
import {
  type ConnectionKind,
  detectConnection,
  parseLndConnect,
  parseLndhub,
} from '@/lightning/connection';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';
import { scanInto } from '@/lib/scan-result';

const KINDS: {
  value: ConnectionKind;
  label: string;
  placeholder: string;
}[] = [
  { value: 'lnd', label: 'LND', placeholder: 'lndconnect://host:8080?macaroon=...' },
  { value: 'nwc', label: 'NWC', placeholder: 'nostr+walletconnect://...' },
  { value: 'lndhub', label: 'LNDHub', placeholder: 'lndhub://login:password@https://host' },
];

/** Returns a validation message, or null if the string looks usable. */
function validate(value: string, expected: string): string | null {
  const kind = detectConnection(value);
  if (!kind) return expected;
  try {
    if (kind === 'lndhub') parseLndhub(value);
    if (kind === 'lnd') parseLndConnect(value);
  } catch (e) {
    return errorMessage(e);
  }
  return null;
}

/** Links a node or wallet via its connection string. */
export default function Connect() {
  const styles = useStyles();
  const { addNode } = useWallet();
  const t = useT();
  const params = useLocalSearchParams<{ uri?: string }>();
  const [kind, setKind] = useState<ConnectionKind>(() => (params.uri && detectConnection(params.uri)) || 'lnd');
  const [name, setName] = useState('');
  const [uri, setUri] = useState(params.uri ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = uri.trim();
  const invalid = trimmed !== '' ? validate(trimmed, t('connect.expected')) : null;
  const current = KINDS.find((k) => k.value === kind)!;

  const updateUri = (value: string) => {
    setUri(value);
    // Follow whatever the user pasted.
    const detected = detectConnection(value);
    if (detected) setKind(detected);
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) updateUri(text.trim());
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await addNode(name, trimmed);
      goHome();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title={t('connect.title')} />
      <Segmented options={KINDS} value={kind} onChange={setKind} />
      <Mono style={styles.intro}>
        {`${t(`connect.help.${current.value}`)}\n${t('connect.secret')}`}
      </Mono>
      <View style={styles.field}>
        <Label>{t('connect.field')}</Label>
        <Input value={uri} onChangeText={updateUri} multiline placeholder={current.placeholder} />
        <Button label={t('common.paste')} variant="ghost" onPress={paste} />
        <Button
          label={t('scan.button')}
          variant="ghost"
          onPress={async () => {
            const scanned = await scanInto();
            if (scanned) updateUri(scanned);
          }}
        />
      </View>
      <View style={styles.field}>
        <Label>{t('connect.name')}</Label>
        <Input
          value={name}
          onChangeText={setName}
          placeholder={t('connect.namePlaceholder')}
          maxLength={40}
        />
      </View>
      <ErrorText>{invalid}</ErrorText>
      <ErrorText>{error}</ErrorText>
      <Button
        label={t('connect.submit')}
        onPress={connect}
        loading={busy}
        disabled={trimmed === '' || invalid !== null}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    intro: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    field: { gap: space.xs },
  }),
);
