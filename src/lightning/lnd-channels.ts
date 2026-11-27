/**
 * Channel management and fee estimation over LND REST.
 * https://lightning.engineering/api-docs/api/lnd/
 */
import { HttpError, type RequestOptions, toSats } from './http';
import type {
  Channel,
  ChannelFeatures,
  ChannelPolicy,
  CloseChannelRequest,
  FeeEstimate,
  OpenChannelRequest,
} from './types';

type Int64 = string | number;
export type LndRest = <T>(path: string, options?: RequestOptions) => Promise<T>;
/** First update of a streaming LND endpoint. */
export type LndStream = <T>(path: string, method: 'GET' | 'DELETE') => Promise<T | null>;

type LndChannel = {
  chan_id?: string;
  active?: boolean;
  remote_pubkey: string;
  channel_point: string;
  capacity?: Int64;
  local_balance?: Int64;
  remote_balance?: Int64;
  private?: boolean;
  initiator?: boolean;
  peer_alias?: string;
};

type PendingChannel = {
  remote_node_pub: string;
  channel_point: string;
  capacity?: Int64;
  local_balance?: Int64;
  remote_balance?: Int64;
  private?: boolean;
  initiator?: 'INITIATOR_UNKNOWN' | 'INITIATOR_LOCAL' | 'INITIATOR_REMOTE' | 'INITIATOR_BOTH';
};

type PendingChannels = {
  pending_open_channels?: { channel: PendingChannel }[];
  waiting_close_channels?: { channel: PendingChannel; limbo_balance?: Int64 }[];
  pending_force_closing_channels?: {
    channel: PendingChannel;
    limbo_balance?: Int64;
    blocks_til_maturity?: number;
  }[];
};

type CloseUpdate = {
  result?: { close_pending?: { txid?: string }; chan_close?: { closing_txid?: string } };
  error?: { message?: string };
};

const PUBKEY_RE = /^(02|03)[0-9a-f]{64}$/i;

/** Fee targets offered in the UI, in blocks. */
const FEE_TARGETS: { speed: FeeEstimate['speed']; targetBlocks: number }[] = [
  { speed: 'fast', targetBlocks: 2 },
  { speed: 'medium', targetBlocks: 6 },
  { speed: 'slow', targetBlocks: 144 },
];

/** Parses "pubkey@host:port" or a bare pubkey. */
export function parseNodeUri(value: string): { pubkey: string; host: string | null } {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  const pubkey = (at >= 0 ? trimmed.slice(0, at) : trimmed).toLowerCase();
  const host = at >= 0 ? trimmed.slice(at + 1) : null;
  if (!PUBKEY_RE.test(pubkey)) throw new Error('Invalid node public key (66 hex characters).');
  if (host !== null && !/^[\w.\-[\]:]+:\d{1,5}$|^[\w.-]+$/.test(host)) {
    throw new Error('Invalid node address, expected host:port.');
  }
  return { pubkey, host };
}

function hexToBase64(hex: string): string {
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary);
}

/** LND returns txid bytes base64-encoded in internal (reversed) byte order. */
function txidFromBase64(value: string): string {
  const binary = atob(value);
  let hex = '';
  for (let i = binary.length - 1; i >= 0; i--) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

function fromPending(
  c: PendingChannel,
  state: Channel['state'],
  extra: Partial<Channel> = {},
): Channel {
  return {
    channelPoint: c.channel_point,
    remotePubkey: c.remote_node_pub,
    state,
    capacitySats: toSats(c.capacity),
    localSats: toSats(c.local_balance),
    remoteSats: toSats(c.remote_balance),
    private: c.private ?? false,
    initiator: c.initiator === 'INITIATOR_LOCAL' || c.initiator === 'INITIATOR_BOTH',
    ...extra,
  };
}

export function createLndChannels(rest: LndRest, stream: LndStream): ChannelFeatures {
  return {
    async list() {
      const [open, pending] = await Promise.all([
        rest<{ channels?: LndChannel[] }>('/v1/channels?peer_alias_lookup=true'),
        rest<PendingChannels>('/v1/channels/pending'),
      ]);
      const channels: Channel[] = [
        ...(pending.pending_open_channels ?? []).map((p) => fromPending(p.channel, 'opening')),
        ...(open.channels ?? []).map(
          (c): Channel => ({
            channelPoint: c.channel_point,
            remotePubkey: c.remote_pubkey,
            alias: c.peer_alias || undefined,
            state: c.active ? 'active' : 'inactive',
            capacitySats: toSats(c.capacity),
            localSats: toSats(c.local_balance),
            remoteSats: toSats(c.remote_balance),
            private: c.private ?? false,
            initiator: c.initiator,
            chanId: c.chan_id,
          }),
        ),
        ...(pending.waiting_close_channels ?? []).map((p) =>
          fromPending(p.channel, 'closing', { limboSats: toSats(p.limbo_balance) }),
        ),
        ...(pending.pending_force_closing_channels ?? []).map((p) =>
          fromPending(p.channel, 'force_closing', {
            limboSats: toSats(p.limbo_balance),
            maturityBlocks: p.blocks_til_maturity,
          }),
        ),
      ];
      return channels;
    },

    async open(request: OpenChannelRequest) {
      const { pubkey, host } = parseNodeUri(request.nodeUri);
      if (host) {
        try {
          await rest('/v1/peers', {
            method: 'POST',
            body: { addr: { pubkey, host }, perm: false, timeout: '20' },
            timeoutMs: 30_000,
          });
        } catch (error) {
          // Being connected already is fine; anything else means we cannot open.
          if (!(error instanceof HttpError && /already connected/i.test(error.message))) throw error;
        }
      }
      const point = await rest<{ funding_txid_bytes?: string; funding_txid_str?: string; output_index?: number }>(
        '/v1/channels',
        {
          method: 'POST',
          body: {
            node_pubkey: hexToBase64(pubkey),
            local_funding_amount: request.amountSats.toString(),
            sat_per_vbyte: String(Math.max(1, Math.round(request.satPerVbyte))),
            private: request.private,
          },
          timeoutMs: 60_000,
        },
      );
      const txid =
        point.funding_txid_str ?? (point.funding_txid_bytes ? txidFromBase64(point.funding_txid_bytes) : '');
      return { channelPoint: `${txid}:${point.output_index ?? 0}` };
    },

    async close(request: CloseChannelRequest) {
      const [txid, index] = request.channelPoint.split(':');
      const params = [`force=${request.force}`];
      if (!request.force && request.satPerVbyte) {
        params.push(`sat_per_vbyte=${Math.max(1, Math.round(request.satPerVbyte))}`);
      }
      // CloseChannel streams until the channel is fully closed; the first
      // update (close_pending) carries the closing txid.
      const update = await stream<CloseUpdate>(`/v1/channels/${txid}/${index}?${params.join('&')}`, 'DELETE');
      if (update?.error) throw new Error(update.error.message ?? 'Closing the channel failed');
      const raw = update?.result?.close_pending?.txid ?? update?.result?.chan_close?.closing_txid;
      return { closingTxid: raw ? txidFromBase64(raw) : null };
    },

    async policies() {
      const report = await rest<{
        channel_fees?: { channel_point: string; base_fee_msat?: Int64; fee_per_mil?: Int64 }[];
      }>('/v1/fees');
      const out: Record<string, ChannelPolicy> = {};
      for (const c of report.channel_fees ?? []) {
        out[c.channel_point] = { baseFeeMsat: toSats(c.base_fee_msat), feePpm: Number(c.fee_per_mil ?? 0) };
      }
      return out;
    },

    async updatePolicy(channelPoint: string, policy: ChannelPolicy) {
      const [txid, index] = channelPoint.split(':');
      await rest('/v1/chanpolicy', {
        method: 'POST',
        body: {
          chan_point: { funding_txid_str: txid, output_index: Number(index) },
          base_fee_msat: policy.baseFeeMsat.toString(),
          fee_rate_ppm: policy.feePpm,
          // Required by LND; 80 blocks is its default.
          time_lock_delta: policy.timeLockDelta ?? 80,
        },
      });
    },
  };
}

export async function estimateLndFees(rest: LndRest): Promise<FeeEstimate[]> {
  return Promise.all(
    FEE_TARGETS.map(async ({ speed, targetBlocks }) => {
      const data = await rest<{ sat_per_kw?: Int64 }>(`/v2/wallet/estimatefee/${targetBlocks}`);
      // 1 vbyte = 4 weight units, 1 kw = 1000 weight units.
      const satPerVbyte = Math.max(1, Math.ceil((Number(data.sat_per_kw ?? 253) * 4) / 1000));
      return { speed, targetBlocks, satPerVbyte };
    }),
  );
}
