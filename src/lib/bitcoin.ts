import { isLnurl } from '@/lightning/lnurl';

import { parseUnits } from './format';

/**
 * What the user pasted or scanned on the send screen. Pure parsing; the node
 * does the real validation (checksum, network) when it builds the payment.
 */
export type PaymentInput =
  | { type: 'lightning'; invoice: string }
  | {
      type: 'onchain';
      address: string;
      /** From a BIP21 "amount" parameter. */
      amountSats?: bigint;
      label?: string;
      /** BIP21 unified QR: a lightning invoice for the same payment. */
      lightning?: string;
    }
  /** LNURL (pay or withdraw) or Lightning address; resolved on the LNURL screen. */
  | { type: 'lnurl'; value: string }
  | { type: 'unknown'; value: string };

// Bech32/bech32m (segwit v0, taproot) for mainnet, testnet/signet and regtest,
// and base58 P2PKH/P2SH for mainnet and testnet.
const BECH32_RE = /^(bc|tb|bcrt)1[02-9ac-hj-np-z]{8,87}$/i;
const BASE58_RE = /^[123mn][1-9A-HJ-NP-Za-km-z]{25,39}$/;
const INVOICE_RE = /^ln(bc|tb|bcrt|tbs)[0-9a-z]+$/i;

export function isBitcoinAddress(value: string): boolean {
  const v = value.trim();
  // Bech32 must not mix case.
  if (BECH32_RE.test(v)) return v === v.toLowerCase() || v === v.toUpperCase();
  return BASE58_RE.test(v);
}

export function isLightningInvoice(value: string): boolean {
  return INVOICE_RE.test(value.trim());
}

export function parsePaymentInput(raw: string): PaymentInput {
  const value = raw.trim();
  const lower = value.toLowerCase();

  if (lower.startsWith('lightning:')) {
    const invoice = value.slice('lightning:'.length);
    if (isLightningInvoice(invoice)) return { type: 'lightning', invoice };
    return isLnurl(invoice) ? { type: 'lnurl', value: invoice } : { type: 'unknown', value };
  }
  if (isLightningInvoice(value)) return { type: 'lightning', invoice: value };

  if (lower.startsWith('bitcoin:')) {
    const rest = value.slice('bitcoin:'.length);
    const q = rest.indexOf('?');
    const address = q >= 0 ? rest.slice(0, q) : rest;
    const params = new Map<string, string>();
    if (q >= 0) {
      for (const pair of rest.slice(q + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        try {
          params.set(pair.slice(0, eq).toLowerCase(), decodeURIComponent(pair.slice(eq + 1)));
        } catch {
          // Malformed escape: ignore this parameter.
        }
      }
    }
    const lightning = params.get('lightning');
    if (!isBitcoinAddress(address)) {
      // BIP21 allows an empty address when a lightning invoice is given.
      return lightning && isLightningInvoice(lightning)
        ? { type: 'lightning', invoice: lightning }
        : { type: 'unknown', value };
    }
    const amount = params.get('amount');
    return {
      type: 'onchain',
      address,
      amountSats: amount ? parseUnits(amount, 8) : undefined,
      label: params.get('label') || params.get('message') || undefined,
      lightning: lightning && isLightningInvoice(lightning) ? lightning : undefined,
    };
  }

  if (isBitcoinAddress(value)) return { type: 'onchain', address: value };
  if (isLnurl(value)) return { type: 'lnurl', value };
  return { type: 'unknown', value };
}

/**
 * What the recipient field shows for a pasted or scanned value: the bare
 * address or invoice, never the "bitcoin:" / "lightning:" URI around it.
 * For a unified BIP21 QR that is the lightning invoice, since that is what
 * gets paid. The send screen keeps the full URI aside for amount and label.
 */
export function destinationText(raw: string): string {
  const parsed = parsePaymentInput(raw);
  if (parsed.type === 'lightning') return parsed.invoice;
  if (parsed.type === 'onchain') return parsed.lightning ?? parsed.address;
  if (parsed.type === 'lnurl') return parsed.value;
  return raw;
}
