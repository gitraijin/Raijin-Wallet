/**
 * LNDHub backend (BlueWallet protocol, also served by lndhub.go, LNbits'
 * LndHub extension, ...). Custodial accounts on someone else's node.
 */
import { checkInvoice } from './bolt11';
import { parseLndhub } from './connection';
import { HttpError, requestJson, toSats } from './http';
import type { WalletBackend, WalletPayment } from './types';

const PAYMENT_PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 15_000;
/** LNDHub error code for an expired or invalid token. */
const BAD_AUTH = 1;

type HubError = { error: true; code?: number; message?: string };
type AuthResponse = { access_token: string; refresh_token: string };
type BalanceResponse = { BTC?: { AvailableBalance?: number | string } };
type InvoiceResponse = { payment_request?: string; pay_req?: string };
type OutgoingTx = {
  type?: string;
  payment_hash?: string | { type: string; data: number[] };
  payment_preimage?: string;
  value?: number | string;
  fee?: number | string;
  timestamp?: number | string;
  memo?: string;
};
type IncomingInvoice = {
  r_hash?: string | { type: string; data: number[] };
  payment_hash?: string;
  payment_request?: string;
  ispaid?: boolean;
  amt?: number | string;
  timestamp?: number | string;
  description?: string;
};

function isHubError(data: unknown): data is HubError {
  return typeof data === 'object' && data !== null && (data as HubError).error === true;
}

/** Some hubs return hashes as Node Buffer JSON ({type:'Buffer', data:[...]}). */
function hashToString(hash: IncomingInvoice['r_hash']): string | undefined {
  if (!hash) return undefined;
  if (typeof hash === 'string') return hash;
  return hash.data.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createLndhubBackend(uri: string): Promise<WalletBackend> {
  const { login, password, baseUrl } = parseLndhub(uri);
  let accessToken = '';

  async function authenticate(): Promise<void> {
    const data = await requestJson<AuthResponse | HubError>(`${baseUrl}/auth?type=auth`, {
      method: 'POST',
      body: { login, password },
    });
    if (isHubError(data) || !data.access_token) {
      throw new Error(isHubError(data) && data.message ? data.message : 'LNDHub login failed');
    }
    accessToken = data.access_token;
  }

  /** Authenticated call; re-logs in once if the token has expired. */
  async function call<T>(path: string, body?: unknown, retried = false): Promise<T> {
    let data: T | HubError;
    try {
      data = await requestJson<T | HubError>(`${baseUrl}${path}`, {
        method: body !== undefined ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      });
    } catch (error) {
      if (!retried && error instanceof HttpError && error.status === 401) {
        await authenticate();
        return call<T>(path, body, true);
      }
      throw error;
    }
    if (isHubError(data)) {
      if (!retried && data.code === BAD_AUTH) {
        await authenticate();
        return call<T>(path, body, true);
      }
      throw new Error(data.message ?? `LNDHub error ${data.code ?? ''}`.trim());
    }
    return data;
  }

  await authenticate();

  return {
    info: {
      label: `lndhub // ${baseUrl.replace(/^https:\/\//, '')}`,
      network: null,
      sendTargets: ['lightning'],
      onchainReceive: false,
    },

    async getSnapshot() {
      const [balance, outgoing, incoming] = await Promise.all([
        call<BalanceResponse>('/balance'),
        call<OutgoingTx[]>(`/gettxs?limit=${PAYMENT_PAGE_SIZE}&offset=0`),
        call<IncomingInvoice[]>(`/getuserinvoices?limit=${PAYMENT_PAGE_SIZE}`),
      ]);

      const sent: WalletPayment[] = outgoing
        .filter((tx) => tx.type === 'paid_invoice')
        .map((tx, i) => {
          const value = toSats(tx.value);
          return {
            id: hashToString(tx.payment_hash) ?? tx.payment_preimage ?? `out-${i}`,
            direction: 'out',
            state: 'complete',
            rail: 'lightning',
            amountSats: value < 0n ? -value : value,
            feeSats: toSats(tx.fee),
            timestamp: Number(tx.timestamp ?? 0),
            description: tx.memo || undefined,
          };
        });

      const received: WalletPayment[] = incoming
        .filter((inv) => inv.ispaid)
        .map((inv, i) => ({
          id: hashToString(inv.r_hash) ?? inv.payment_hash ?? inv.payment_request ?? `in-${i}`,
          direction: 'in',
          state: 'complete',
          rail: 'lightning',
          amountSats: toSats(inv.amt),
          feeSats: 0n,
          timestamp: Number(inv.timestamp ?? 0),
          description: inv.description || undefined,
        }));

      return {
        balanceSats: toSats(balance.BTC?.AvailableBalance),
        breakdown: null,
        payments: [...sent, ...received]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, PAYMENT_PAGE_SIZE),
        lastSyncedAt: new Date(),
      };
    },

    async createInvoice({ amountSats, description }) {
      if (!amountSats) throw new Error('LNDHub invoices need an amount.');
      const data = await call<InvoiceResponse>('/addinvoice', {
        amt: amountSats.toString(),
        memo: description,
      });
      const invoice = data.payment_request ?? data.pay_req;
      if (!invoice) throw new Error('LNDHub returned no invoice');
      return { invoice, feeSats: 0n };
    },

    async getOnchainAddress() {
      throw new Error('On-chain is not available over LNDHub.');
    },

    async prepareSend({ destination, amountSats }) {
      const checked = checkInvoice(destination, amountSats);
      return {
        kind: 'lightning',
        destination,
        amountSats: checked.amountSats,
        feeSats: undefined, // hubs reserve a fee and settle it after routing
        confirm: async () => {
          await call('/payinvoice', {
            invoice: destination,
            ...(checked.zeroAmount ? { amount: Number(checked.amountSats) } : {}),
          });
          return { state: 'complete' };
        },
      };
    },

    async subscribe(onChange) {
      // LNDHub has no push channel, so poll for incoming payments.
      const timer = setInterval(onChange, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    },

    async disconnect() {
      accessToken = '';
    },
  };
}
