import { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { ErrorText, Input, Label, Mono, Segmented } from '@/components/ui';
import type { TKey } from '@/i18n';
import type { FeeEstimate } from '@/lightning';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Choice = FeeEstimate['speed'] | 'custom';

/**
 * On-chain fee rate selection: the node's estimates for fast / medium / slow,
 * or a custom sat/vB. Reports the chosen rate, or undefined while none is valid.
 */
export function FeePicker({ onChange }: { onChange: (satPerVbyte: number | undefined) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { backend } = useWallet();
  const t = useT();
  const [estimates, setEstimates] = useState<FeeEstimate[] | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [picked, setChoice] = useState<Choice>('medium');
  // Without estimates the only way is a custom rate.
  const failed = !backend?.estimateFees || fetchFailed;
  const choice: Choice = failed ? 'custom' : picked;
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!backend?.estimateFees) return;
    backend
      .estimateFees()
      .then((value) => !cancelled && setEstimates(value))
      .catch(() => !cancelled && setFetchFailed(true));
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const customRate = /^\d+$/.test(custom.trim()) ? Number(custom.trim()) : undefined;
  const customInvalid = choice === 'custom' && custom.trim() !== '' && (!customRate || customRate < 1);
  const selected = estimates?.find((e) => e.speed === choice);
  const rate = choice === 'custom' ? (customRate && customRate >= 1 ? customRate : undefined) : selected?.satPerVbyte;

  useEffect(() => {
    onChange(rate);
  }, [rate, onChange]);

  const options: { value: Choice; label: string }[] = [
    ...(estimates ?? []).map((e) => ({ value: e.speed, label: t(`fee.${e.speed}` as TKey) })),
    { value: 'custom', label: t('fee.custom') },
  ];

  return (
    <View style={styles.block}>
      <Label>{t('fee.label')}</Label>
      {!estimates && !failed ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : (
        <Segmented options={options} value={choice} onChange={setChoice} />
      )}
      {selected && choice !== 'custom' ? (
        <Mono style={styles.hint}>
          {t('fee.rate', { rate: selected.satPerVbyte, blocks: selected.targetBlocks })}
        </Mono>
      ) : null}
      {choice === 'custom' ? (
        <>
          {failed ? <Mono style={styles.hint}>{t('fee.unavailable')}</Mono> : null}
          <Input
            value={custom}
            onChangeText={setCustom}
            keyboardType="number-pad"
            placeholder={t('fee.customRate')}
          />
          {customInvalid ? <ErrorText>{t('fee.invalid')}</ErrorText> : null}
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.xs },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    spinner: { alignSelf: 'flex-start' },
  }),
);
