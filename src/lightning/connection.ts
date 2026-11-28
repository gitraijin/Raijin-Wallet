/**
 * Connection strings for the `connect` variant. Pure parsing, no network and
 * no heavy imports, so screens can use it for validation.
 */

export type ConnectionKind = 'nwc' | 'lndhub' | 'lnd' | 'onchain';

export type LndhubConnection = { login: string; password: string; baseUrl: string };
export type LndConnection = {
  baseUrl: string;
  macaroonHex: string;
  /** The node's TLS certificate (DER, standard base64), if the string carries one. */
  certBase64?: string;
};

export function detectConnection(value: string): ConnectionKind | null {
  const lower = value.trim().toLowerCase();
  if (lower.startsWith('nostr+walletconnect://') || lower.startsWith('nostrwalletconnect://')) return 'nwc';
  if (lower.startsWith('lndhub://')) return 'lndhub';
  if (lower.startsWith('lndconnect://')) return 'lnd';
  // The app's own on-chain wallet (keys from the app seed, nothing secret in the string).
  if (lower.startsWith('raijin-onchain://')) return 'onchain';
  return null;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** BlueWallet format: lndhub://login:password@https://host[:port][/path] */
export function parseLndhub(value: string): LndhubConnection {
  const match = /^lndhub:\/\/([^:@]+):(.+?)@(https?:\/\/\S+)$/i.exec(value.trim());
  if (!match) throw new Error('Expected lndhub://login:password@https://host');
  const [, login, password, baseUrl] = match;
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('LNDHub server must use https://');
  return { login, password, baseUrl: stripTrailingSlash(baseUrl) };
}

function base64UrlToHex(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  let hex = '';
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * lndconnect://host:port?cert=...&macaroon=...
 * (https://github.com/LN-Zap/lndconnect/blob/master/lnd_connect_uri.md)
 *
 * The `cert` parameter (base64url DER) lets the app accept the node's own
 * self-signed certificate; .onion hosts are reached over Tor.
 */
export function parseLndConnect(value: string): LndConnection {
  const match = /^lndconnect:\/\/([^/?#]+)[^?]*\?(.*)$/i.exec(value.trim());
  if (!match) throw new Error('Expected lndconnect://host:port?macaroon=...');
  const [, hostPort, query] = match;

  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0) params.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  const macaroon = params.get('macaroon');
  if (!macaroon) throw new Error('The lndconnect string has no macaroon.');

  // lndconnect encodes the macaroon as base64url; some tools emit hex instead.
  const macaroonHex = /^[0-9a-f]+$/i.test(macaroon) ? macaroon.toLowerCase() : base64UrlToHex(macaroon);
  const cert = params.get('cert');
  const certBase64 = cert
    ? (() => {
        const b64 = cert.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
        return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      })()
    : undefined;
  return { baseUrl: `https://${hostPort}`, macaroonHex, certBase64 };
}
