/**
 * LNURL-pay (LUD-06), Lightning addresses (LUD-16), LNURL-withdraw (LUD-03)
 * and the lnurlp:// / lnurlw:// schemes (LUD-17). Talks to the service
 * directly (no third-party proxy) through the app's HTTP layer.
 */
import { decodeInvoice } from '@getalby/lightning-tools/bolt11';

import { requestJson } from './http';

export type LnurlPay = {
  tag: 'payRequest';
  /** Service domain, shown to the user. */
  domain: string;
  /** Lightning address, if the request came from one. */
  address?: string;
  callback: string;
  minSats: bigint;
  maxSats: bigint;
  description: string;
  /** Max comment length; 0 = comments not accepted. */
  commentAllowed: number;
};

export type LnurlWithdraw = {
  tag: 'withdrawRequest';
  domain: string;
  callback: string;
  k1: string;
  minSats: bigint;
  maxSats: bigint;
  description: string;
};

export type LnurlRequest = LnurlPay | LnurlWithdraw;

const LN_ADDRESS_RE = /^([a-z0-9\-_.+]+)@([a-z0-9\-.]+\.[a-z0-9-]+)$/i;
const LNURL_RE = /^lnurl1[02-9ac-hj-np-z]+$/i;

/* ------------------------------------------------------------------ */
/* Detection and decoding                                              */
/* ------------------------------------------------------------------ */

export function isLightningAddress(value: string): boolean {
  return LN_ADDRESS_RE.test(value.trim());
}

/** True for anything resolveLnurl can handle. */
export function isLnurl(value: string): boolean {
  const v = value.trim().replace(/^lightning:/i, '');
  return LNURL_RE.test(v) || /^lnurl[pw]:\/\//i.test(v) || isLightningAddress(v);
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
  }
  return chk;
}

/** Bech32 without the 90-character limit (LUD-01). Returns the decoded URL. */
export function decodeLnurl(value: string): string {
  const lower = value.trim().toLowerCase();
  const sep = lower.lastIndexOf('1');
  const hrp = lower.slice(0, sep);
  const data: number[] = [];
  for (const char of lower.slice(sep + 1)) {
    const index = CHARSET.indexOf(char);
    if (index < 0) throw new Error('Invalid LNURL.');
    data.push(index);
  }
  const expanded = [
    ...Array.from(hrp, (c) => c.charCodeAt(0) >> 5),
    0,
    ...Array.from(hrp, (c) => c.charCodeAt(0) & 31),
  ];
  if (hrp !== 'lnurl' || data.length < 7 || polymod([...expanded, ...data]) !== 1) {
    throw new Error('Invalid LNURL (checksum).');
  }
  // 5-bit groups -> bytes.
  let acc = 0;
  let bits = 0;
  let url = '';
  for (const word of data.slice(0, -6)) {
    acc = (acc << 5) | word;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      url += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return url;
}

function hostOf(url: string): string {
  return url.replace(/^\w+:\/\//, '').split(/[/?#:]/)[0].toLowerCase();
}

/** Onion services use plain http (Tor already encrypts); everything else must be https. */
function schemeFor(host: string): string {
  return host.endsWith('.onion') ? 'http' : 'https';
}

function assertSafeUrl(url: string): void {
  const host = hostOf(url);
  if (!/^https:\/\//i.test(url) && !(host.endsWith('.onion') && /^http:\/\//i.test(url))) {
    throw new Error('LNURL services must use https://');
  }
}

function withParams(url: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

type ServiceError = { status?: string; reason?: string };

function throwIfError(data: unknown): void {
  const e = data as ServiceError;
  if (e?.status?.toUpperCase() === 'ERROR') throw new Error(e.reason || 'The service returned an error.');
}

/* ------------------------------------------------------------------ */
/* Resolving                                                           */
/* ------------------------------------------------------------------ */

type RawPay = {
  tag?: string;
  callback?: string;
  minSendable?: number;
  maxSendable?: number;
  metadata?: string;
  commentAllowed?: number;
};
type RawWithdraw = {
  tag?: string;
  callback?: string;
  k1?: string;
  minWithdrawable?: number;
  maxWithdrawable?: number;
  defaultDescription?: string;
};

function describe(metadata: string | undefined): string {
  try {
    const entries = JSON.parse(metadata ?? '[]') as [string, string][];
    return (
      entries.find(([type]) => type === 'text/plain')?.[1] ??
      entries.find(([type]) => type === 'text/identifier')?.[1] ??
      ''
    );
  } catch {
    return '';
  }
}

const msatToSats = (msat: number | undefined, round: 'up' | 'down') =>
  BigInt(round === 'up' ? Math.ceil((msat ?? 0) / 1000) : Math.floor((msat ?? 0) / 1000));

/** Fetches the first step of an LNURL (address, bech32 LNURL or lnurlp/lnurlw link). */
export async function resolveLnurl(input: string): Promise<LnurlRequest> {
  const value = input.trim().replace(/^lightning:/i, '');
  let url: string;
  let address: string | undefined;

  const match = LN_ADDRESS_RE.exec(value);
  if (match) {
    const [, user, domain] = match;
    address = value.toLowerCase();
    url = `${schemeFor(domain.toLowerCase())}://${domain.toLowerCase()}/.well-known/lnurlp/${user.toLowerCase()}`;
  } else if (/^lnurl[pw]:\/\//i.test(value)) {
    const rest = value.replace(/^lnurl[pw]:\/\//i, '');
    url = `${schemeFor(hostOf(rest))}://${rest}`;
  } else if (LNURL_RE.test(value)) {
    url = decodeLnurl(value);
  } else {
    throw new Error('Not an LNURL or Lightning address.');
  }
  assertSafeUrl(url);

  const data = await requestJson<RawPay & RawWithdraw & ServiceError>(url);
  throwIfError(data);
  const domain = hostOf(url);

  if (data.tag === 'payRequest') {
    if (!data.callback) throw new Error('Invalid LNURL-pay response.');
    assertSafeUrl(data.callback);
    const minSats = msatToSats(data.minSendable, 'up');
    const maxSats = msatToSats(data.maxSendable, 'down');
    if (maxSats < minSats || maxSats <= 0n) throw new Error('The service accepts no valid amount.');
    return {
      tag: 'payRequest',
      domain,
      address,
      callback: data.callback,
      minSats,
      maxSats,
      description: describe(data.metadata),
      commentAllowed: Math.max(0, Math.floor(data.commentAllowed ?? 0)),
    };
  }

  if (data.tag === 'withdrawRequest') {
    if (!data.callback || !data.k1) throw new Error('Invalid LNURL-withdraw response.');
    assertSafeUrl(data.callback);
    const minSats = msatToSats(data.minWithdrawable, 'up');
    const maxSats = msatToSats(data.maxWithdrawable, 'down');
    if (maxSats < minSats || maxSats <= 0n) throw new Error('Nothing to withdraw.');
    return {
      tag: 'withdrawRequest',
      domain,
      callback: data.callback,
      k1: data.k1,
      minSats,
      maxSats,
      description: data.defaultDescription ?? '',
    };
  }

  throw new Error(`Unsupported LNURL type: ${data.tag ?? 'unknown'}`);
}

/* ------------------------------------------------------------------ */
/* Pay and withdraw                                                    */
/* ------------------------------------------------------------------ */

export type LnurlSuccessAction =
  | { tag: 'message'; message: string }
  | { tag: 'url'; description: string; url: string };

/** Step two of LNURL-pay: asks the service for an invoice over exactly `amountSats`. */
export async function requestLnurlInvoice(
  pay: LnurlPay,
  amountSats: bigint,
  comment?: string,
): Promise<{ invoice: string; successAction: LnurlSuccessAction | null }> {
  if (amountSats < pay.minSats || amountSats > pay.maxSats) throw new Error('Amount out of range.');
  const params: Record<string, string> = { amount: (amountSats * 1000n).toString() };
  const trimmed = comment?.trim();
  if (trimmed && pay.commentAllowed > 0) params.comment = trimmed.slice(0, pay.commentAllowed);

  const data = await requestJson<{ pr?: string; successAction?: LnurlSuccessAction } & ServiceError>(
    withParams(pay.callback, params),
  );
  throwIfError(data);
  if (!data.pr) throw new Error('The service sent no invoice.');

  // Never pay more than the user agreed to.
  const decoded = decodeInvoice(data.pr);
  if (!decoded) throw new Error('The service sent an invalid invoice.');
  if (BigInt(decoded.millisatoshi) !== amountSats * 1000n) {
    throw new Error('The invoice amount does not match the requested amount.');
  }

  const action = data.successAction;
  const successAction =
    action?.tag === 'message' && typeof action.message === 'string'
      ? { tag: 'message' as const, message: action.message.slice(0, 144) }
      : action?.tag === 'url' && typeof action.url === 'string' && /^https:\/\//i.test(action.url)
        ? { tag: 'url' as const, description: String(action.description ?? '').slice(0, 144), url: action.url }
        : null;
  return { invoice: data.pr, successAction };
}

/** Step two of LNURL-withdraw: hands the service an invoice to pay. */
export async function submitLnurlWithdraw(withdraw: LnurlWithdraw, invoice: string): Promise<void> {
  const data = await requestJson<ServiceError>(withParams(withdraw.callback, { k1: withdraw.k1, pr: invoice }));
  throwIfError(data);
  if (data.status?.toUpperCase() !== 'OK') throw new Error('The service did not accept the withdrawal.');
}
