import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ErrorText, Label, Mono } from '@/components/ui';
import type { Utxo } from '@/lightning';
import { errorMessage, truncateMiddle } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

/**
 * Coin control: choose which on-chain coins (UTXOs) a send may spend.
 * Empty selection = the node chooses. Unconfirmed coins are shown but
 * cannot be selected (LND only spends confirmed ones by default).
 */
export function CoinPicker({ selected, onChange }: { selected: string[]; onChange: (outpoints: string[]) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const btc = useAmount();
  const { backend } = useWallet();
  const [coins, setCoins] = useState<Utxo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    backend
      ?.listUtxos?.()
      .then((list) => active && setCoins(list))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [backend]);

  if (!backend?.listUtxos) return null;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!coins) return <ActivityIndicator color={colors.accent} />;

  const toggle = (outpoint: string) =>
    onChange(selected.includes(outpoint) ? selected.filter((o) => o !== outpoint) : [...selected, outpoint]);
  const total = coins.filter((c) => selected.includes(c.outpoint)).reduce((s, c) => s + c.amountSats, 0n);

  return (
    <View style={styles.wrap}>
      <Label>{t('coins.title')}</Label>
      <Mono style={styles.hint}>
        {selected.length === 0 ? t('coins.auto') : t('coins.selected', { count: selected.length, amount: btc.format(total) })}
      </Mono>
      {coins.map((coin) => {
        const on = selected.includes(coin.outpoint);
        const unconfirmed = coin.confirmations === 0;
        return (
          <Pressable
            key={coin.outpoint}
            onPress={() => !unconfirmed && toggle(coin.outpoint)}
            disabled={unconfirmed}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: unconfirmed }}
            style={[styles.row, on && { borderColor: colors.accent }, unconfirmed && styles.disabled]}>
            <Mono style={[styles.box, { color: on ? colors.accent : colors.textDim }]}>{on ? '[x]' : '[ ]'}</Mono>
            <View style={styles.middle}>
              <Mono style={styles.amount}>{btc.format(coin.amountSats)}</Mono>
              <Mono style={styles.hint} numberOfLines={1}>
                {`${truncateMiddle(coin.address, 10)} · ${unconfirmed ? t('coins.unconfirmed') : t('coins.confs', { n: coin.confirmations })}`}
              </Mono>
            </View>
          </Pressable>
        );
      })}
      {coins.length === 0 ? <Mono style={styles.hint}>{t('coins.none')}</Mono> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 11 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.sm,
    },
    disabled: { opacity: 0.45 },
    box: { fontFamily: fonts.bold, fontSize: 13 },
    middle: { flex: 1, gap: 2 },
    amount: { fontFamily: fonts.bold, fontSize: 13 },
  }),
);
