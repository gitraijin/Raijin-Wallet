/**
 * Payment links and QR contents → app route. Pure (no heavy imports), so it
 * also works in +native-intent.tsx, which runs before the app is set up.
 */
import { detectConnection } from '@/lightning/connection';

import { parsePaymentInput } from './bitcoin';

export type LinkRoute =
  | { pathname: '/cashu-receive'; params: { token: string } }
  | { pathname: '/connect'; params: { uri: string } }
  | { pathname: '/channel-open'; params: { node: string } }
  | { pathname: '/send'; params: { value: string } };

export function isCashuTokenText(value: string): boolean {
  return /^(cashu:(\/\/)?)?cashu[AB][A-Za-z0-9_\-+/=]+$/i.test(value.trim());
}

export function classifyLink(raw: string): LinkRoute | null {
  let value = raw.trim();
  if (!value) return null;
  if (isCashuTokenText(value)) {
    return { pathname: '/cashu-receive', params: { token: value.replace(/^cashu:(\/\/)?/i, '') } };
  }
  if (detectConnection(value)) return { pathname: '/connect', params: { uri: value } };
  if (/^0[23][0-9a-f]{64}(@\S+)?$/i.test(value)) return { pathname: '/channel-open', params: { node: value } };
  // lnurlp://, lnurlw:// and lightning://… (some apps add slashes)
  value = value.replace(/^lightning:\/\//i, 'lightning:');
  if (/^(lnurl[pwc]?|keyauth):\/\//i.test(value)) return { pathname: '/send', params: { value } };
  if (parsePaymentInput(value).type !== 'unknown') return { pathname: '/send', params: { value } };
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(value)) return { pathname: '/send', params: { value } };
  return null;
}

/** Same as classifyLink, as a path string ("/send?value=…"). */
export function linkToPath(raw: string): string | null {
  const route = classifyLink(raw);
  if (!route) return null;
  const query = Object.entries(route.params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${route.pathname}?${query}`;
}
