/**
 * LND REST backend (your own node). Connects with an lndconnect:// string.
 * Needs a macaroon with invoice, read, offchain, onchain and peer permissions
 * (channels, on-chain); admin.macaroon works.
 */
import { checkInvoice } from './bolt11';
import { parseLndConnect } from './connection';
import {
  type NetOptions,
  rawRequest,
  requestFirstStreamUpdate,
  requestJson,
  type RequestOptions,
  toSats,
} from './http';
import { createLndChannels, estimateLndFees } from './lnd-channels';
import { bumpLndFee, listLndOnchain, listLndUtxos, prepareLndOnchainSend } from './lnd-onchain';
import { createLndRouting } from './lnd-routing';
import type { PaymentState, WalletBackend, WalletPayment } from './types';

const PAYMENT_PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 100;
const POLL_INTERVAL_MS = 15_000;
const PAYMENT_TIMEOUT_SECS = 60;

type Int64 = string | number;
type GetInfo = { alias?: string; chains?: { chain: string; network: string }[] };
type ChannelBalance = { local_balance?: { sat?: Int64 }; balance?: Int64 };
type ChainBalance = { confirmed_balance?: Int64; unconfirmed_balance?: Int64 };
type LndPayment = {
  payment_hash: string;
  payment_preimage?: string;
  payment_request?: string;
  value_sat?: Int64;
  fee_sat?: Int64;
  creation_date?: Int64;
  status?: 'UNKNOWN' | 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'INITIATED';
};
type LndInvoice = {
  r_hash: string;
  r_preimage?: string;
  payment_request?: string;
  memo?: string;
  amt_paid_sat?: Int64;
  creation_date?: Int64;
  settle_date?: Int64;
  expiry?: Int64;
  state?: 'OPEN' | 'SETTLED' | 'CANCELED' | 'ACCEPTED';
};
type PaymentList = { payments?: LndPayment[]; first_index_offset?: Int64 };
type InvoiceList = { invoices?: LndInvoice[]; first_index_offset?: Int64 };
/** History cursor: next index offsets (null = list exhausted). */
type Cursor = { p: string | null; i: string | null };

/** LND REST encodes bytes fields as base64. */
function base64ToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const binary = atob(value);
    let hex = '';
    for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
  } catch {
    return undefined;
  }
}

function hexToBase64(hex: string): string {
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary);
}

function mapSent(p: LndPayment): WalletPayment {
  return {
    id: p.payment_hash,
    direction: 'out',
    state: paymentState(p.status),
    rail: 'lightning',
    amountSats: toSats(p.value_sat),
    feeSats: toSats(p.fee_sat),
    timestamp: Number(p.creation_date ?? 0),
    paymentHash: p.payment_hash,
    preimage: p.payment_preimage && !/^0+$/.test(p.payment_preimage) ? p.payment_preimage : undefined,
    invoice: p.payment_request || undefined,
  };
}

function mapReceived(inv: LndInvoice): WalletPayment {
  return {
    id: inv.r_hash,
    direction: 'in',
    state: inv.state === 'SETTLED' ? 'complete' : 'pending',
    rail: 'lightning',
    amountSats: toSats(inv.amt_paid_sat),
    feeSats: 0n,
    timestamp: Number(inv.settle_date || inv.creation_date || 0),
    description: inv.memo || undefined,
    paymentHash: base64ToHex(inv.r_hash),
    preimage: base64ToHex(inv.r_preimage),
    invoice: inv.payment_request || undefined,
  };
}

const isReceived = (inv: LndInvoice) => inv.state === 'SETTLED' || inv.state === 'ACCEPTED';
type RouterUpdate = {
  result?: { status?: LndPayment['status']; failure_reason?: string };
  error?: { message?: string };
};

function paymentState(status: LndPayment['status']): PaymentState {
  if (status === 'SUCCEEDED') return 'complete';
  if (status === 'FAILED') return 'failed';
  return 'pending';
}

/** Routing fee cap: 1% of the amount, at least 10 sat. */
function feeLimitSats(amountSats: bigint): bigint {
  const percent = amountSats / 100n;
  return percent > 10n ? percent : 10n;
}

export async function createLndBackend(uri: string): Promise<WalletBackend> {
  const { baseUrl, macaroonHex, certBase64 } = parseLndConnect(uri);
  const net: NetOptions = { certBase64 };
  const auth = { 'Grpc-Metadata-macaroon': macaroonHex };

  const rest = <T>(path: string, options: RequestOptions = {}) =>
    requestJson<T>(`${baseUrl}${path}`, { ...options, net, headers: { ...auth, ...options.headers } });
  const stream = <T>(path: string, method: 'GET' | 'DELETE') =>
    requestFirstStreamUpdate<T>(`${baseUrl}${path}`, { method, net, headers: auth, timeoutMs: 60_000 });

  // Fails fast on a wrong host, an untrusted TLS cert or a bad macaroon.
  const info = await rest<GetInfo>('/v1/getinfo');
  const channels = createLndChannels(rest, stream);
  let cachedAddress: string | null = null;

  return {
    info: {
      label: info.alias ? `lnd // ${info.alias}` : 'lnd',
      network: info.chains?.[0]?.network ?? null,
      sendTargets: ['lightning', 'bitcoin'],
      onchainReceive: true,
    },

    async getSnapshot() {
      const [channels, chain, payments, invoices, onchain] = await Promise.all([
        rest<ChannelBalance>('/v1/balance/channels'),
        rest<ChainBalance>('/v1/balance/blockchain'),
        rest<PaymentList>(`/v1/payments?reversed=true&include_incomplete=true&max_payments=${PAYMENT_PAGE_SIZE}`),
        rest<InvoiceList>(`/v1/invoices?reversed=true&num_max_invoices=${PAYMENT_PAGE_SIZE}`),
        // History without on-chain entries beats no history at all.
        listLndOnchain(rest).catch((error) => {
          console.warn('[lnd] on-chain history failed', error);
          return [] as WalletPayment[];
        }),
      ]);

      const sent = (payments.payments ?? []).map(mapSent);
      const received = (invoices.invoices ?? []).filter(isReceived).map(mapReceived);

      const lightningSats = toSats(channels.local_balance?.sat ?? channels.balance);
      const onchainSats = toSats(chain.confirmed_balance);
      return {
        // Spendable lightning plus confirmed on-chain funds.
        balanceSats: lightningSats + onchainSats,
        breakdown: {
          lightningSats,
          onchainSats,
          onchainPendingSats: toSats(chain.unconfirmed_balance),
        },
        payments: [...sent, ...received, ...onchain]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, PAYMENT_PAGE_SIZE),
        lastSyncedAt: new Date(),
      };
    },

    channels: {
      ...channels,
      async rebalance({ outChannelPoint, inChannelPoint, amountSats, maxFeeSats }) {
        const list = await channels.list();
        const out = list.find((c) => c.channelPoint === outChannelPoint);
        const into = list.find((c) => c.channelPoint === inChannelPoint);
        if (!out?.chanId || !into) throw new Error('Channel not found or not active.');
        if (out.channelPoint === into.channelPoint) throw new Error('Choose two different channels.');
        const invoice = await rest<{ payment_request: string }>('/v1/invoices', {
          method: 'POST',
          body: { value: amountSats.toString(), memo: 'raijin rebalance', expiry: '600' },
        });
        // Pay ourselves: out through one channel, back in through the other.
        const text = await sendViaRouter(baseUrl, auth, net, {
          payment_request: invoice.payment_request,
          outgoing_chan_ids: [out.chanId],
          last_hop_pubkey: hexToBase64(into.remotePubkey),
          allow_self_payment: true,
          fee_limit_sat: maxFeeSats.toString(),
          timeout_seconds: PAYMENT_TIMEOUT_SECS,
          no_inflight_updates: true,
        });
        const lines = text.trim().split('\n').filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1] ?? '{}') as RouterUpdate & {
          result?: { fee_sat?: Int64 };
        };
        if (last.error) throw new Error(last.error.message ?? 'Rebalance failed');
        if (paymentState(last.result?.status) !== 'complete') {
          throw new Error(`Rebalance failed: ${last.result?.failure_reason ?? 'no route'}`);
        }
        return { feeSats: toSats(last.result?.fee_sat) };
      },
    },

    listUtxos: () => listLndUtxos(rest),

    bumpOnchainFee: (txid, satPerVbyte) => bumpLndFee(rest, txid, satPerVbyte),

    async history(cursor) {
      const state: Cursor = cursor ? (JSON.parse(cursor) as Cursor) : { p: '0', i: '0' };
      const first = cursor === null;
      const [payments, invoices, onchain] = await Promise.all([
        state.p !== null
          ? rest<PaymentList>(
              `/v1/payments?reversed=true&include_incomplete=true&max_payments=${HISTORY_PAGE_SIZE}&index_offset=${state.p}`,
            )
          : Promise.resolve<PaymentList>({}),
        state.i !== null
          ? rest<InvoiceList>(
              `/v1/invoices?reversed=true&num_max_invoices=${HISTORY_PAGE_SIZE}&index_offset=${state.i}`,
            )
          : Promise.resolve<InvoiceList>({}),
        // The on-chain list has no paging; it comes complete with the first page.
        first ? listLndOnchain(rest).catch(() => [] as WalletPayment[]) : Promise.resolve([] as WalletPayment[]),
      ]);
      const sentPage = payments.payments ?? [];
      const invoicePage = invoices.invoices ?? [];
      const next: Cursor = {
        p: state.p !== null && sentPage.length === HISTORY_PAGE_SIZE ? String(payments.first_index_offset ?? '0') : null,
        i: state.i !== null && invoicePage.length === HISTORY_PAGE_SIZE ? String(invoices.first_index_offset ?? '0') : null,
      };
      // index_offset 0 would restart from the newest entry.
      if (next.p === '0') next.p = null;
      if (next.i === '0') next.i = null;
      return {
        payments: [...sentPage.map(mapSent), ...invoicePage.filter(isReceived).map(mapReceived), ...onchain].sort(
          (a, b) => b.timestamp - a.timestamp,
        ),
        cursor: next.p === null && next.i === null ? null : JSON.stringify(next),
      };
    },

    async lookupInvoice(paymentHash) {
      const inv = await rest<LndInvoice>(`/v1/invoice/${paymentHash}`);
      if (inv.state === 'SETTLED') return 'paid';
      if (inv.state === 'CANCELED') return 'canceled';
      const expiresAt = Number(inv.creation_date ?? 0) + Number(inv.expiry ?? 3600);
      return expiresAt * 1000 < Date.now() ? 'expired' : 'open';
    },

    routing: createLndRouting(rest),

    estimateFees: () => estimateLndFees(rest),

    prepareOnchainSend: (request) => prepareLndOnchainSend(rest, request),

    async createInvoice({ amountSats, description }) {
      const data = await rest<{ payment_request: string }>('/v1/invoices', {
        method: 'POST',
        body: { value: (amountSats ?? 0n).toString(), memo: description },
      });
      return { invoice: data.payment_request, feeSats: 0n };
    },

    async getOnchainAddress(fresh) {
      if (!fresh && cachedAddress) return cachedAddress;
      const data = await rest<{ address: string }>('/v1/newaddress?type=WITNESS_PUBKEY_HASH');
      cachedAddress = data.address;
      return data.address;
    },

    async prepareSend({ destination, amountSats }) {
      const checked = checkInvoice(destination, amountSats);
      const feeLimit = feeLimitSats(checked.amountSats);
      return {
        kind: 'lightning',
        details: [{ key: 'maxFee', sats: feeLimit }],
        destination,
        amountSats: checked.amountSats,
        feeSats: undefined,
        confirm: async () => {
          // Router v2 streams JSON updates; with no_inflight_updates the stream
          // carries only the final state, then closes.
          const text = await sendViaRouter(baseUrl, auth, net, {
            payment_request: destination,
            ...(checked.zeroAmount ? { amt: checked.amountSats.toString() } : {}),
            fee_limit_sat: feeLimit.toString(),
            timeout_seconds: PAYMENT_TIMEOUT_SECS,
            no_inflight_updates: true,
          });
          const lines = text.trim().split('\n').filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1] ?? '{}') as RouterUpdate;
          if (last.error) throw new Error(last.error.message ?? 'Payment failed');
          const state = paymentState(last.result?.status);
          if (state === 'failed') {
            throw new Error(`Payment failed: ${last.result?.failure_reason ?? 'unknown reason'}`);
          }
          return { state };
        },
      };
    },

    async subscribe(onChange) {
      // LND REST streams would need a long-lived connection; polling is simpler and robust.
      const timer = setInterval(onChange, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    },

    async disconnect() {},
  };
}

/** POST to the streaming router endpoint and return the raw body (newline-delimited JSON). */
async function sendViaRouter(
  baseUrl: string,
  auth: Record<string, string>,
  net: NetOptions,
  body: object,
): Promise<string> {
  let response;
  try {
    response = await rawRequest(`${baseUrl}/v2/router/send`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      net,
      timeoutMs: (PAYMENT_TIMEOUT_SECS + 15) * 1000,
    });
  } catch (error) {
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) {
      // The node may still complete it; history will show the final state.
      throw new Error('No answer from the node in time. Check the history before retrying.');
    }
    throw error;
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (JSON.parse(response.text) as { message?: string }).message ?? message;
    } catch {}
    throw new Error(message);
  }
  return response.text;
}
