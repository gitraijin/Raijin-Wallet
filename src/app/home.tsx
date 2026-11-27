import { Redirect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedWordmark, Cursor } from '@/components/brand';
import { BrandMark } from '@/components/BrandMark';
import { PaymentRow } from '@/components/PaymentRow';
import { Button, Label, Mono, Panel } from '@/components/ui';
import { formatTimestamp } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { MASK, useAmount } from '@/preferences/useAmount';
import { StyleIcon } from '@/components/StyleIcon';
import { fonts, makeStyles, shape, space, useTheme } from '@/theme';
import { useTorStatus } from '@/net/tor';
import { useWallet } from '@/wallet/WalletContext';
import { useCashu } from '@/cashu/CashuContext';

export default function Home() {
  const styles = useStyles();
  const { colors, uiStyle } = useTheme();
  const fujin = uiStyle === 'fujin';
  const { status, balanceSats, breakdown, payments, lastSyncedAt, refresh, backend, activeNode, nodes } =
    useWallet();
  const { t, unit, hidden, update } = usePreferences();
  const amount = useAmount();
  const tor = useTorStatus();
  const cashu = useCashu();
  const fiat = amount.fiat(balanceSats);
  const network = backend?.info.network ?? null;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Connecting, failed or no node left: the entry gate shows the right screen.
  if (status !== 'ready') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }>
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <BrandMark size={28} />
            <AnimatedWordmark style={styles.brand} />
          </View>
          <View style={styles.topRight}>
            {tor.state === 'on' ? <Mono style={[styles.badge, styles.badgeTor]}>TOR</Mono> : null}
            {network ? (
              <Mono
                style={[styles.badge, network === 'mainnet' ? styles.badgeMain : styles.badgeTest]}>
                {network.toUpperCase()}
              </Mono>
            ) : null}
            <Pressable onPress={() => router.push('/scan')} hitSlop={12} accessibilityLabel={t('scan.title')}>
              {fujin ? <StyleIcon name="scan" color={colors.text} size={26} /> : <Mono style={styles.settings}>[⌗]</Mono>}
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={12}
              accessibilityLabel={t('home.settings')}>
              {fujin ? <StyleIcon name="settings" color={colors.text} size={26} /> : <Mono style={styles.settings}>[≡]</Mono>}
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/nodes')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('nodes.manage')}
          style={styles.nodeRow}>
          <Mono style={styles.nodeName} numberOfLines={1}>
            {`⌁ ${activeNode?.name ?? '—'}`}
          </Mono>
          <Mono style={styles.nodeSwitch}>
            {nodes.length > 1 ? (fujin ? `${nodes.length} ▾` : `[${nodes.length}] ▾`) : '▾'}
          </Mono>
        </Pressable>

        <Panel
          label={t('home.balance')}
          accent={colors.borderStrong}
          right={
            <Pressable
              onPress={() => update({ hidden: !hidden })}
              hitSlop={12}
              accessibilityRole="switch"
              accessibilityState={{ checked: hidden }}
              accessibilityLabel={hidden ? t('home.show') : t('home.hide')}>
              {fujin ? (
                <StyleIcon name={hidden ? 'eyeOff' : 'eye'} color={colors.textDim} size={22} />
              ) : (
                <Mono style={styles.eye}>{hidden ? '[ ○ ]' : '[ ◉ ]'}</Mono>
              )}
            </Pressable>
          }>
          <Pressable
            // btc → sat (12 345) → sat with dots (12.345) → btc
            onPress={() => update({ unit: unit === 'btc' ? 'sat' : unit === 'sat' ? 'satDot' : 'btc' })}
            accessibilityLabel={t('home.switchUnit')}
            style={styles.balanceRow}>
            <Mono style={styles.balance} adjustsFontSizeToFit numberOfLines={1}>
              {hidden ? MASK : amount.value(balanceSats)}
            </Mono>
            <Mono style={styles.unit}>{amount.unitLabel}</Mono>
          </Pressable>
          {fiat ? <Mono style={styles.fiat}>{hidden ? MASK : fiat}</Mono> : null}
          {breakdown ? (
            <View style={styles.split}>
              <Mono style={styles.splitText}>
                {`ϟ ${hidden ? MASK : amount.value(breakdown.lightningSats)}`}
              </Mono>
              <Mono style={styles.splitText}>
                {`₿ ${hidden ? MASK : amount.value(breakdown.onchainSats)}`}
                {breakdown.onchainPendingSats > 0n && !hidden
                  ? `  ${t('home.pending', { amount: amount.value(breakdown.onchainPendingSats) })}`
                  : ''}
              </Mono>
            </View>
          ) : null}
          <Label>
            {lastSyncedAt
              ? t('home.synced', { time: formatTimestamp(lastSyncedAt.getTime() / 1000) })
              : t('home.syncing')}
            {lastSyncedAt ? null : <Cursor color={colors.textDim} />}
          </Label>
        </Panel>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={t('home.receive')}
              variant="secondary"
              onPress={() => router.push('/receive')}
            />
          </View>
          <View style={styles.action}>
            <Button label={t('home.send')} onPress={() => router.push('/send')} />
          </View>
        </View>

        <Button
          label={
            cashu.totalSats > 0n
              ? `${t('home.cashu')} // ${hidden ? MASK : amount.format(cashu.totalSats)}`
              : t('home.cashu')
          }
          variant="ghost"
          onPress={() => router.push('/cashu')}
        />

        {backend?.channels ? (
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label={t('home.channels')} variant="ghost" onPress={() => router.push('/channels')} />
            </View>
            {backend.routing ? (
              <View style={styles.action}>
                <Button label={t('dashboard.short')} variant="ghost" onPress={() => router.push('/dashboard')} />
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionRow}>
          <Label style={styles.sectionLabel}>{t('home.transactions')}</Label>
          {payments.length > 0 ? (
            <Pressable onPress={() => router.push('/history')} hitSlop={12}>
              <Mono style={styles.more}>{`[${t('history.showAll')}]`}</Mono>
            </Pressable>
          ) : null}
        </View>
        {payments.length === 0 ? (
          <Mono style={styles.empty}>{t('home.empty')}</Mono>
        ) : (
          payments.slice(0, 20).map((payment) => <PaymentRow key={payment.id} payment={payment} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md, gap: space.md },

    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    brand: {
      fontFamily: fonts.bold,
      fontSize: 18,
      letterSpacing: 4,
      color: colors.primary,
    },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    badge: {
      fontFamily: fonts.medium,
      fontSize: 10,
      letterSpacing: 1.5,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderWidth: 1,
    },
    badgeMain: { color: colors.primary, borderColor: colors.primary },
    badgeTest: { color: colors.accent, borderColor: colors.accent },
    badgeTor: { color: colors.textDim, borderColor: colors.borderStrong },
    settings: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
    nodeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    nodeName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, flexShrink: 1 },
    nodeSwitch: { fontSize: 12, color: colors.textDim },

    balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    // Manrope's digits are taller than JetBrains Mono's: give the line room, or the tops get cut.
    balance: {
      fontFamily: fonts.bold,
      fontSize: 38,
      lineHeight: shape.radius > 0 ? 50 : undefined,
      paddingTop: shape.radius > 0 ? 2 : 0,
      color: colors.primary,
      flexShrink: 1,
    },
    unit: { color: colors.textDim, fontSize: 14 },
    fiat: { color: colors.textDim, fontSize: 15 },
    split: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 2 },
    splitText: { color: colors.textDim, fontSize: 12 },
    eye: { fontFamily: fonts.bold, fontSize: 12, color: colors.textDim },

    actions: { flexDirection: 'row', gap: space.md },
    action: { flex: 1 },

    sectionLabel: { marginTop: space.sm },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    more: { fontFamily: fonts.bold, fontSize: 11, color: colors.accent },
    empty: { color: colors.textFaint, fontSize: 13 },
  }),
);
