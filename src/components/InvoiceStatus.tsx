import { decodeInvoice } from '@getalby/lightning-tools/bolt11';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Mono } from '@/components/ui';
import type { InvoiceStatus as Status } from '@/lightning';
import { onPaymentReceived } from '@/motion/payments';
import { ResultMark } from '@/motion/ResultMark';
import { usePreferences } from '@/preferences/PreferencesContext';
import { makeStyles, useTheme } from '@/theme';
import { useWallet } from '@/wallet/WalletContext';

const POLL_MS = 3000;

function remaining(expiresAt: number): number {
  return Math.max(0, Math.round(expiresAt - Date.now() / 1000));
}

function mmss(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Under a shown invoice: countdown to expiry and "paid" as soon as the
 * backend reports it (lookupInvoice polling), or, without lookup, when a
 * payment of the same amount arrives.
 */
export function InvoiceStatus({
  invoice,
  amountSats,
  onPaid,
}: {
  invoice: string;
  amountSats?: bigint;
  onPaid?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const { backend } = useWallet();
  const [decoded] = useState(() => {
    try {
      const d = decodeInvoice(invoice);
      return d ? { hash: d.paymentHash, expiresAt: d.timestamp + (d.expiry ?? 3600) } : null;
    } catch {
      return null;
    }
  });
  const [left, setLeft] = useState(() => (decoded ? remaining(decoded.expiresAt) : 0));
  const [status, setStatus] = useState<Status>('open');

  // Countdown.
  useEffect(() => {
    if (!decoded || status !== 'open') return;
    const timer = setInterval(() => setLeft(remaining(decoded.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [decoded, status]);

  // Backend lookup.
  useEffect(() => {
    if (!decoded || status !== 'open' || !backend?.lookupInvoice) return;
    let active = true;
    const lookup = backend.lookupInvoice.bind(backend);
    const tick = async () => {
      try {
        const next = await lookup(decoded.hash);
        if (active && next !== 'open') setStatus(next);
      } catch {
        // keep polling
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [backend, decoded, status]);

  // Fallback without lookup: a matching incoming payment.
  useEffect(() => {
    if (backend?.lookupInvoice || status !== 'open') return;
    return onPaymentReceived((payment) => {
      if (payment.source === 'lightning' && (!amountSats || payment.amountSats === amountSats)) setStatus('paid');
    });
  }, [backend, status, amountSats]);

  useEffect(() => {
    if (status === 'paid') onPaid?.();
  }, [status, onPaid]);

  if (status === 'paid') return <ResultMark kind="success" label={t('invoice.paid')} />;
  if (status === 'canceled') return <Mono style={{ color: colors.danger }}>{t('invoice.canceled')}</Mono>;
  if (!decoded) return null;
  const expired = status === 'expired' || left === 0;
  return (
    <View style={styles.row}>
      <Mono style={[styles.text, expired && { color: colors.danger }]}>
        {expired ? t('invoice.expired') : t('invoice.expiresIn', { time: mmss(left) })}
      </Mono>
      {!expired ? <Mono style={styles.text}>{t('invoice.waiting')}</Mono> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    text: { color: colors.textDim, fontSize: 12 },
  }),
);
