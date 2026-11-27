import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useCashu } from '@/cashu/CashuContext';
import { Button, ErrorText, Header, Label, Mono, Panel, Screen, Segmented } from '@/components/ui';
import { type ExportRow, historicalPrices, rowsFromCashu, rowsFromPayments, toCsv } from '@/export/csv';
import { FileActions, type PendingFile } from '@/export/FileActions';
import { canSaveToFolder, saveTextFile } from '@/export/save';
import type { HistoryPage, WalletPayment } from '@/lightning';
import { errorMessage } from '@/lib/format';
import { ProgressBar } from '@/motion/ProgressBar';
import { usePreferences } from '@/preferences/PreferencesContext';
import { makeStyles } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

type Source = 'all' | 'node' | 'cashu';

/** CSV export of the history, optionally with the fiat value at payment time. */
export default function Export() {
  const styles = useStyles();
  const { t, fiat } = usePreferences();
  const { payments, activeNode, backend } = useWallet();
  const { history, mintById } = useCashu();
  const [source, setSource] = useState<Source>('all');
  const [withFiat, setWithFiat] = useState<'yes' | 'no'>(fiat !== 'off' ? 'yes' : 'no');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [file, setFile] = useState<PendingFile | null>(null);

  const previewCount =
    (source !== 'cashu' ? payments.length : 0) + (source !== 'node' ? history.length : 0);
  const currency = fiat !== 'off' ? fiat : 'USD';

  const run = async () => {
    setError(null);
    setDone(false);
    setFile(null);
    try {
      // The complete node history, page by page, where the backend can page.
      let nodeRows = source !== 'cashu' ? rowsFromPayments(payments) : [];
      if (source !== 'cashu' && backend?.history) {
        const all = new Map<string, WalletPayment>();
        let cursor: string | null = null;
        for (let page = 0; page < 200; page++) {
          setProgress(Math.min(50, page * 2));
          const result: HistoryPage = await backend.history(cursor);
          result.payments.forEach((p) => all.set(p.id, p));
          cursor = result.cursor;
          if (!cursor) break;
        }
        nodeRows = rowsFromPayments([...all.values()]);
      }
      const rows: ExportRow[] = [
        ...nodeRows,
        ...(source !== 'node' ? rowsFromCashu(history, (id) => mintById(id)?.name ?? '?') : []),
      ];
      let csv: string;
      if (withFiat === 'yes') {
        const prices = await historicalPrices(
          rows.map((r) => r.timestamp),
          currency,
          (n, total) => setProgress(50 + (n / total) * 50),
        );
        csv = toCsv(rows, { currency, prices });
      } else {
        csv = toCsv(rows);
      }
      const date = new Date().toISOString().slice(0, 10);
      const node = (activeNode?.name ?? 'raijin').replace(/[^\w-]+/g, '-').slice(0, 30);
      const name = `raijin-${source}-${node}-${date}.csv`;
      if (canSaveToFolder) setFile({ name, content: csv, mimeType: 'text/csv' });
      else await saveTextFile(name, csv, 'text/csv');
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Screen scroll>
      <Header title={t('export.title')} />
      <Panel label={t('export.what')}>
        <Segmented<Source>
          options={[
            { value: 'all', label: t('export.all') },
            { value: 'node', label: 'node' },
            { value: 'cashu', label: 'cashu' },
          ]}
          value={source}
          onChange={setSource}
        />
        <Label>{t('export.fiat', { currency })}</Label>
        <Segmented<'yes' | 'no'>
          options={[
            { value: 'yes', label: t('common.yes') },
            { value: 'no', label: t('common.no') },
          ]}
          value={withFiat}
          onChange={setWithFiat}
        />
        <Mono style={styles.hint}>
          {backend?.history && source !== 'cashu' ? t('export.full') : t('export.count', { count: previewCount })}
        </Mono>
        <Mono style={styles.hint}>{t('export.hint')}</Mono>
      </Panel>
      {progress !== null ? <ProgressBar progress={progress} label={t('export.prices')} /> : null}
      {done && file ? <FileActions file={file} intro={t('export.ready')} /> : null}
      {done && !file ? <Mono style={styles.hint}>{t('export.done')}</Mono> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('export.run')} onPress={run} loading={progress !== null} disabled={previewCount === 0 && !backend?.history} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
