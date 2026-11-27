import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CashuEntryRow } from '@/components/CashuEntryRow';
import { Button, Header, Label, Mono, Panel } from '@/components/ui';
import { useCashu } from '@/cashu/CashuContext';
import { isBackedUp } from '@/cashu/seed';
import { usePreferences } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { fonts, makeStyles, space, useTheme } from '@/theme';

/** Ecash overview: balance per mint, actions, history. */
export default function Cashu() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t, hidden } = usePreferences();
  const amount = useAmount();
  const { loaded, mints, balances, totalSats, history, selectedMint, selectMint, sync } = useCashu();
  const [refreshing, setRefreshing] = useState(false);
  const [backedUp, setBackedUp] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isBackedUp().then((v) => active && setBackedUp(v), () => {});
      return () => {
        active = false;
      };
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await sync();
    setRefreshing(false);
  }, [sync]);

  // Settle pending deposits and sent tokens whenever the screen opens.
  useEffect(() => {
    void sync();
  }, [sync]);

  const show = (sats: bigint) => (hidden ? MASK : amount.format(sats));
  const fiat = amount.fiat(totalSats);
  const noMint = loaded && mints.length === 0;
  const selectedBalance = selectedMint ? (balances[selectedMint.id] ?? 0n) : 0n;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <Header title="cashu" />

        <Panel label={t('cashu.balance')} accent={colors.borderStrong}>
          <Mono style={styles.balance} adjustsFontSizeToFit numberOfLines={1}>
            {show(totalSats)}
          </Mono>
          {fiat && !hidden ? <Mono style={styles.dim}>{fiat}</Mono> : null}
          <Mono style={styles.hint}>{t('cashu.custodyNote')}</Mono>
        </Panel>

        {!backedUp && totalSats > 0n ? (
          <Panel label={t('seed.notBackedUp')} accent={colors.danger}>
            <Mono style={styles.hint}>{t('seed.notBackedUpHint')}</Mono>
            <Button label={t('seed.backupNow')} variant="danger" onPress={() => router.push('/cashu-seed')} />
          </Panel>
        ) : null}

        {noMint ? (
          <Panel label={t('cashu.start')}>
            <Mono style={styles.hint}>{t('cashu.intro')}</Mono>
            <Button label={t('cashu.addMint')} onPress={() => router.push('/cashu-mints')} />
            <Button label={t('cashu.receiveToken')} variant="ghost" onPress={() => router.push('/cashu-receive')} />
          </Panel>
        ) : (
          <>
            <Panel
              label={t('cashu.mints')}
              right={
                <Pressable onPress={() => router.push('/cashu-mints')} hitSlop={12}>
                  <Mono style={styles.link}>{`[${t('cashu.manage')}]`}</Mono>
                </Pressable>
              }>
              {mints.map((mint) => {
                const active = mint.id === selectedMint?.id;
                return (
                  <Pressable
                    key={mint.id}
                    onPress={() => selectMint(mint.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={styles.mintRow}>
                    <Mono style={[styles.mintName, active && { color: colors.accent }]} numberOfLines={1}>
                      {`${active ? '▸' : ' '} ${mint.name}`}
                    </Mono>
                    <Mono style={styles.mintBalance}>{show(balances[mint.id] ?? 0n)}</Mono>
                  </Pressable>
                );
              })}
            </Panel>

            <View style={styles.actions}>
              <View style={styles.action}>
                <Button label={t('cashu.receive')} variant="secondary" onPress={() => router.push('/cashu-receive')} />
              </View>
              <View style={styles.action}>
                <Button
                  label={t('cashu.send')}
                  disabled={selectedBalance === 0n}
                  onPress={() => router.push('/cashu-send')}
                />
              </View>
            </View>
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button label={t('cashu.deposit')} variant="ghost" onPress={() => router.push('/cashu-deposit')} />
              </View>
              <View style={styles.action}>
                <Button
                  label={t('cashu.withdraw')}
                  variant="ghost"
                  disabled={selectedBalance === 0n}
                  onPress={() => router.push('/cashu-withdraw')}
                />
              </View>
            </View>
          </>
        )}

        <Button label={t('seed.title')} variant="ghost" onPress={() => router.push('/cashu-seed')} />

        <Label style={styles.section}>{t('cashu.history')}</Label>
        {history.length === 0 ? (
          <Mono style={styles.empty}>{t('cashu.empty')}</Mono>
        ) : (
          history.map((entry) => <CashuEntryRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md, gap: space.md },
    balance: { fontFamily: fonts.bold, fontSize: 32, color: colors.primary },
    dim: { color: colors.textDim, fontSize: 14 },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    link: { fontFamily: fonts.bold, fontSize: 11, color: colors.accent },
    mintRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: 6,
    },
    mintName: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
    mintBalance: { fontSize: 13, color: colors.textDim },
    actions: { flexDirection: 'row', gap: space.md },
    action: { flex: 1 },
    section: { marginTop: space.sm },
    empty: { color: colors.textFaint, fontSize: 13 },
  }),
);
