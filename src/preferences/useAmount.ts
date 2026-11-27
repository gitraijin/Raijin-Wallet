import type { TKey } from '@/i18n';
import { formatBitcoin, formatFiat, formatSats, parseBitcoin, SATS_PER_BTC, unitLabel } from '@/lib/format';

import { usePreferences } from './PreferencesContext';
import { usePrice } from './PriceContext';

export const MASK = '••••••';

/** Formatting and parsing of bitcoin amounts in the user's unit and currency. */
export function useAmount() {
  const { unit, fiat, hidden, lang } = usePreferences();
  const { rates } = usePrice();
  const rate = fiat !== 'off' ? rates?.[fiat] : undefined;
  const label = unitLabel(unit);

  return {
    unit,
    hidden,
    unitLabel: label,
    /** "12 345" / "0.00012345" */
    value: (sats: bigint) => formatBitcoin(sats, unit),
    /** Any count (e.g. msat) grouped like sats in this unit: "1 234 567" / "1.234.567". */
    group: (n: bigint) => formatSats(n, unit === 'satDot' ? '.' : '\u2009'),
    /** Plain value for an input field, without grouping: "12345" / "0.00012345". */
    input: (sats: bigint) => (unit === 'btc' ? formatBitcoin(sats, unit).replace(/\s/g, '') : sats.toString()),
    /** "12 345 sat" / "0.00012345 BTC" */
    format: (sats: bigint) => `${formatBitcoin(sats, unit)} ${label}`,
    /** "≈ 12,34 €", or null without a currency or price. */
    fiat: (sats: bigint) =>
      fiat !== 'off' && rate !== undefined ? `≈ ${formatFiat(sats, rate, fiat, lang)}` : null,
    parse: (input: string) => parseBitcoin(input, unit),
    keyboardType: unit === 'btc' ? ('decimal-pad' as const) : ('number-pad' as const),
    placeholder: unit === 'btc' ? '0.00000000' : '0',
    invalidKey: (unit === 'btc' ? 'amount.invalidBtc' : 'amount.invalidSat') as TKey,
    /** Currency code for entering amounts in fiat, or null without currency or price. */
    fiatCode: fiat !== 'off' && rate !== undefined ? fiat : null,
    /** Fiat input ("12,50" or "12.50") converted to sats at the current price. */
    parseFiat: (input: string): bigint | undefined => {
      if (rate === undefined) return undefined;
      const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(input.trim().replace(/[\s\u2009]/g, ''));
      if (!match) return undefined;
      const value = Number(`${match[1]}.${match[2] || '0'}`);
      return BigInt(Math.round((value / rate) * Number(SATS_PER_BTC)));
    },
    /** Sats as a plain fiat number for an input field: "12.50". */
    fiatInput: (sats: bigint) => (rate === undefined ? '' : ((Number(sats) / Number(SATS_PER_BTC)) * rate).toFixed(2)),
  };
}
