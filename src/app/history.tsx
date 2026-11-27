import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PaymentRow } from '@/components/PaymentRow';
import { Button, Chips, ErrorText, Header, Input, Mono } from '@/components/ui';
import type { WalletPayment } from '@/lightning';
import { errorMessage } from '@/lib/format';
import { loadNotes, onNotesChange } from '@/lib/notes';
import { usePreferences } from '@/preferences/PreferencesContext';
import { makeStyles, space, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Filter = 'all' | 'in' | 'out' | 'lightning' | 'onchain' | 'pending';

/** Complete history, loaded page by page, with filters, search and notes. */
export default function History() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const { backend, payments: recent } = useWallet();
  const [items, setItems] = useState<WalletPayment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(!backend?.history);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => loadNotes().then(setNotes, () => {});
    read();
    return onNotesChange(read);
  }, []);

  const loadMore = useCallback(
    async (from: string | null) => {
      if (!backend?.history) return;
      setLoading(true);
      setError(null);
      try {
        const page = await backend.history(from);
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.payments.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.cursor);
        setDone(page.cursor === null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [backend],
  );

  useEffect(() => {
    let cancelled = false;
    if (backend?.history) {
      backend
        .history(null)
        .then((page) => {
          if (cancelled) return;
          setItems(page.payments);
          setCursor(page.cursor);
          setDone(page.cursor === null);
        })
        .catch((e) => !cancelled && setError(errorMessage(e)));
    }
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const shown = useMemo(() => {
    const source = backend?.history ? items : recent;
    const q = query.trim().toLowerCase();
    return [...source]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((p) => {
        if (filter === 'in' && p.direction !== 'in') return false;
        if (filter === 'out' && p.direction !== 'out') return false;
        if (filter === 'lightning' && p.rail !== 'lightning') return false;
        if (filter === 'onchain' && p.rail !== 'onchain') return false;
        if (filter === 'pending' && p.state !== 'pending') return false;
        if (!q) return true;
        return [p.description, notes[p.id], p.txid, p.paymentHash, p.amountSats.toString()]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
  }, [backend, items, recent, filter, query, notes]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <FlatList
        contentContainerStyle={styles.content}
        data={shown}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PaymentRow payment={item} note={notes[item.id]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!done && !loading && cursor) void loadMore(cursor);
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Header title={t('history.title')} />
            <Input value={query} onChangeText={setQuery} placeholder={t('history.search')} />
            <Chips
              options={[
                { value: 'all', label: t('history.all') },
                { value: 'in', label: t('history.in') },
                { value: 'out', label: t('history.out') },
                { value: 'lightning', label: 'lightning' },
                { value: 'onchain', label: 'on-chain' },
                { value: 'pending', label: t('history.pending') },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <ErrorText>{error}</ErrorText>
          </View>
        }
        ListEmptyComponent={loading ? undefined : <Mono style={styles.dim}>{t('home.empty')}</Mono>}
        ListFooterComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={styles.footer} />
          ) : !done && cursor ? (
            <Button label={t('history.more')} variant="ghost" onPress={() => loadMore(cursor)} />
          ) : (
            <Mono style={[styles.dim, styles.footer]}>
              {backend?.history ? t('history.end', { count: shown.length }) : t('history.recentOnly')}
            </Mono>
          )
        }
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md },
    header: { gap: space.md, marginBottom: space.sm },
    dim: { color: colors.textDim, fontSize: 12 },
    footer: { marginVertical: space.md },
  }),
);
