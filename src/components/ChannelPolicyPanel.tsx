import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ErrorText, Input, Label, Mono, Panel } from '@/components/ui';
import type { Channel } from '@/lightning';
import { errorMessage } from '@/lib/format';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

/** Our routing fee on one channel: base fee (msat) and rate (ppm). */
export function ChannelPolicyPanel({ channel }: { channel: Channel }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const { backend } = useWallet();
  const features = backend?.channels;
  const [base, setBase] = useState('');
  const [ppm, setPpm] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    features
      ?.policies?.()
      .then((all) => {
        if (!active) return;
        const policy = all[channel.channelPoint];
        if (policy) {
          setBase(policy.baseFeeMsat.toString());
          setPpm(String(policy.feePpm));
        }
        setLoaded(true);
      })
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [features, channel.channelPoint]);

  if (!features?.updatePolicy || (channel.state !== 'active' && channel.state !== 'inactive')) return null;

  const valid = /^\d{1,9}$/.test(base) && /^\d{1,7}$/.test(ppm);

  const save = async () => {
    if (!features.updatePolicy || !valid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await features.updatePolicy(channel.channelPoint, { baseFeeMsat: BigInt(base), feePpm: Number(ppm) });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel label={t('policy.title')}>
      <Mono style={styles.hint}>{t('policy.hint')}</Mono>
      <Label>{t('policy.base')}</Label>
      <Input value={base} onChangeText={setBase} keyboardType="number-pad" placeholder="1000" editable={loaded} />
      <Label>{t('policy.rate')}</Label>
      <Input value={ppm} onChangeText={setPpm} keyboardType="number-pad" placeholder="100" editable={loaded} />
      {base && ppm && !valid ? <ErrorText>{t('policy.invalid')}</ErrorText> : null}
      {saved ? <Mono style={{ color: colors.success }}>{t('policy.saved')}</Mono> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('policy.save')} variant="secondary" onPress={save} loading={busy} disabled={!valid} />
    </Panel>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
