/** Formats a sat amount with thousands separators, e.g. "21 000 000" (or "21.000.000"). */
export function formatSats(sats: bigint | number, separator = '\u2009'): string {
  const value = typeof sats === 'bigint' ? sats : BigInt(Math.trunc(sats));
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return negative ? `-${grouped}` : grouped;
}

/** Parses user input (digits, optional separators) into sats. Returns undefined if empty or invalid. */
export function parseSats(input: string): bigint | undefined {
  const cleaned = input.replace(/[\s,._']/g, '');
  if (!/^\d+$/.test(cleaned)) return undefined;
  return BigInt(cleaned);
}

/** Shortens long strings (invoices, addresses) for display: "lnbc1p3...x8f2". */
export function truncateMiddle(value: string, keep = 10): string {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/** Formats a unix timestamp (seconds) as "YYYY-MM-DD HH:MM". */
export function formatTimestamp(seconds: bigint | number): string {
  const date = new Date(Number(seconds) * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Extracts a readable message from anything thrown by the SDK or JS. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Formats token base units, e.g. 12345678n with 6 decimals -> "12.34" (2 shown by default). */
export function formatUnits(amount: bigint, decimals: number, shown = 2): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').slice(0, shown);
  const wholeStr = formatSats(whole);
  return `${negative ? '-' : ''}${wholeStr}${shown > 0 ? `.${frac}` : ''}`;
}

/** Parses "12.5" into base units with `decimals` places. Returns undefined if invalid or empty. */
export function parseUnits(input: string, decimals: number): bigint | undefined {
  const cleaned = input.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return undefined;
  const [, whole, frac = ''] = match;
  if (frac.length > decimals) return undefined;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** 'satDot' is sats grouped with dots ("12.345") instead of thin spaces ("12 345"). */
export type BitcoinUnit = 'sat' | 'satDot' | 'btc';

export const BITCOIN_UNITS: readonly BitcoinUnit[] = ['sat', 'satDot', 'btc'];

export const SATS_PER_BTC = 100_000_000n;

/** Sats in the chosen unit, without the unit label: "12 345" or "0.00012345". */
export function formatBitcoin(sats: bigint, unit: BitcoinUnit): string {
  if (unit === 'btc') return formatUnits(sats, 8, 8);
  return formatSats(sats, unit === 'satDot' ? '.' : '\u2009');
}

export function unitLabel(unit: BitcoinUnit): string {
  return unit === 'btc' ? 'BTC' : 'sat';
}

/** Parses user input in the chosen unit into sats. */
export function parseBitcoin(input: string, unit: BitcoinUnit): bigint | undefined {
  return unit === 'btc' ? parseUnits(input, 8) : parseSats(input);
}

/** Fiat value of `sats` at `pricePerBtc`, formatted for `locale`, e.g. "1.234,56 €". */
export function formatFiat(sats: bigint, pricePerBtc: number, currency: string, locale: string): string {
  const value = (Number(sats) / Number(SATS_PER_BTC)) * pricePerBtc;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
