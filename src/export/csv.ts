import type { CashuEntry } from '@/cashu/store';
import type { WalletPayment } from '@/lightning';
import { requestJson } from '@/lightning/http';
import { fetchBlockchainTicker } from '@/preferences/PriceContext';

/**
 * Transaction export as CSV (e.g. for a tax return). Optional: the fiat value
 * at the time of each payment, from mempool.space's historical price API
 * (one request per day, through http.ts so Tor applies).
 */

export type ExportRow = {
  timestamp: number;
  source: 'node' | 'cashu';
  direction: 'in' | 'out';
  rail: string;
  state: string;
  amountSats: bigint;
  feeSats: bigint;
  description: string;
};

export function rowsFromPayments(payments: WalletPayment[]): ExportRow[] {
  return payments.map((p) => ({
    timestamp: p.timestamp,
    source: 'node',
    direction: p.direction,
    rail: p.rail,
    state: p.state,
    amountSats: p.amountSats,
    feeSats: p.feeSats,
    description: p.description ?? '',
  }));
}

export function rowsFromCashu(entries: CashuEntry[], mintName: (id: string) => string): ExportRow[] {
  return entries.map((e) => ({
    timestamp: e.timestamp,
    source: 'cashu',
    direction: e.kind === 'mint' || e.kind === 'receive' ? 'in' : 'out',
    rail: `cashu-${e.kind}`,
    state: e.state,
    amountSats: BigInt(e.amount),
    feeSats: BigInt(e.fee),
    description: [mintName(e.mintId), e.memo].filter(Boolean).join(' // '),
  }));
}

type HistoricalResponse = {
  prices: ({ time: number } & Record<string, number>)[];
  exchangeRates: Record<string, number>;
};

/** BTC price in `currency` per UTC day, fetched once per day. */
export async function historicalPrices(
  timestamps: number[],
  currency: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, number>> {
  const days = [...new Set(timestamps.map((ts) => Math.floor(ts / 86400)))];
  const prices = new Map<number, number>();
  let done = 0;
  // mempool.space has no history for CNY, RUB, BRL, …: the USD price of that
  // day times today's exchange rate (from blockchain.info) is close enough.
  let todayRatio: number | null | undefined;
  const usdRatio = async () => {
    if (todayRatio === undefined) {
      const ticker = await fetchBlockchainTicker().catch(() => null);
      todayRatio = ticker && ticker[currency] && ticker.USD ? ticker[currency] / ticker.USD : null;
    }
    return todayRatio;
  };
  for (const day of days) {
    try {
      const data = await requestJson<HistoricalResponse>(
        `https://mempool.space/api/v1/historical-price?currency=${currency === 'EUR' ? 'EUR' : 'USD'}&timestamp=${day * 86400 + 43200}`,
      );
      const point = data.prices[0];
      if (point) {
        const direct = point[currency];
        const fx = data.exchangeRates[`USD${currency}`] ?? (await usdRatio()) ?? NaN;
        const viaUsd = point.USD !== undefined ? point.USD * fx : NaN;
        const price = direct ?? viaUsd;
        if (Number.isFinite(price)) prices.set(day, price);
      }
    } catch {
      // Missing day: the cell stays empty.
    }
    onProgress?.(++done, days.length);
  }
  return prices;
}

function cell(value: string): string {
  // RFC 4180 quoting; a leading = + - @ is neutralized so spreadsheets do not run it as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const btc = (sats: bigint) => {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  return `${negative ? '-' : ''}${abs / 100_000_000n}.${(abs % 100_000_000n).toString().padStart(8, '0')}`;
};

export function toCsv(rows: ExportRow[], fiat?: { currency: string; prices: Map<number, number> }): string {
  const header = [
    'date_utc',
    'source',
    'direction',
    'type',
    'state',
    'amount_sat',
    'fee_sat',
    'amount_btc',
    ...(fiat ? [`price_btc_${fiat.currency.toLowerCase()}`, `amount_${fiat.currency.toLowerCase()}`] : []),
    'description',
  ];
  const lines = [...rows]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((r) => {
      const signed = r.direction === 'out' ? -r.amountSats : r.amountSats;
      const price = fiat?.prices.get(Math.floor(r.timestamp / 86400));
      const fiatCells = fiat
        ? price !== undefined
          ? [price.toFixed(2), ((Number(signed) / 1e8) * price).toFixed(2)]
          : ['', '']
        : [];
      return [
        new Date(r.timestamp * 1000).toISOString(),
        r.source,
        r.direction,
        r.rail,
        r.state,
        signed.toString(),
        r.feeSats.toString(),
        btc(signed),
        ...fiatCells,
        r.description,
      ]
        .map((v) => cell(String(v)))
        .join(',');
    });
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
