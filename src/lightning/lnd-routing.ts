/**
 * Node dashboard data over LND REST: node info, fee report, forwarding
 * history. https://lightning.engineering/api-docs/api/lnd/
 */
import { toSats } from './http';
import type { LndRest } from './lnd-channels';
import type { ForwardEvent, NodeStatus, RoutingFeatures, RoutingSummary } from './types';

type Int64 = string | number;

type GetInfo = {
  alias?: string;
  identity_pubkey: string;
  version?: string;
  block_height?: number;
  synced_to_chain?: boolean;
  synced_to_graph?: boolean;
  num_active_channels?: number;
  num_inactive_channels?: number;
  num_pending_channels?: number;
  num_peers?: number;
  uris?: string[];
};

type FeeReport = {
  day_fee_sum?: Int64;
  week_fee_sum?: Int64;
  month_fee_sum?: Int64;
  channel_fees?: { chan_id?: string; channel_point: string; base_fee_msat?: Int64; fee_per_mil?: Int64 }[];
};

type ForwardingHistory = {
  forwarding_events?: {
    timestamp?: Int64;
    timestamp_ns?: Int64;
    chan_id_in?: string;
    chan_id_out?: string;
    amt_in?: Int64;
    amt_out?: Int64;
    amt_in_msat?: Int64;
    amt_out_msat?: Int64;
    fee?: Int64;
    fee_msat?: Int64;
    peer_alias_in?: string;
    peer_alias_out?: string;
  }[];
};

export function createLndRouting(rest: LndRest): RoutingFeatures {
  return {
    async status(): Promise<NodeStatus> {
      const info = await rest<GetInfo>('/v1/getinfo');
      return {
        alias: info.alias ?? '',
        pubkey: info.identity_pubkey,
        version: info.version ?? '',
        blockHeight: info.block_height ?? 0,
        syncedToChain: info.synced_to_chain ?? false,
        syncedToGraph: info.synced_to_graph ?? false,
        activeChannels: info.num_active_channels ?? 0,
        inactiveChannels: info.num_inactive_channels ?? 0,
        pendingChannels: info.num_pending_channels ?? 0,
        peers: info.num_peers ?? 0,
        uris: info.uris ?? [],
      };
    },

    async summary(): Promise<RoutingSummary> {
      const report = await rest<FeeReport>('/v1/fees');
      const fees = report.channel_fees ?? [];
      const avgPpm = fees.length ? Math.round(fees.reduce((s, c) => s + Number(c.fee_per_mil ?? 0), 0) / fees.length) : 0;
      return {
        daySats: toSats(report.day_fee_sum),
        weekSats: toSats(report.week_fee_sum),
        monthSats: toSats(report.month_fee_sum),
        channelCount: fees.length,
        averageFeePpm: avgPpm,
      };
    },

    async forwards(days: number): Promise<ForwardEvent[]> {
      const end = Math.floor(Date.now() / 1000);
      const data = await rest<ForwardingHistory>('/v1/switch', {
        method: 'POST',
        body: { start_time: String(end - days * 86400), end_time: String(end), num_max_events: 1000 },
      });
      return (data.forwarding_events ?? [])
        .map((e) => ({
          timestamp: Number(e.timestamp ?? 0) || Math.floor(Number(e.timestamp_ns ?? 0) / 1e9),
          amountInSats: toSats(e.amt_in),
          amountOutSats: toSats(e.amt_out),
          // fee_msat is exact; fee is rounded down to sats.
          feeMsat: e.fee_msat !== undefined ? toSats(e.fee_msat) : toSats(e.fee) * 1000n,
          channelIn: e.peer_alias_in || e.chan_id_in || '?',
          channelOut: e.peer_alias_out || e.chan_id_out || '?',
          chanIdIn: e.chan_id_in,
          chanIdOut: e.chan_id_out,
          amountInMsat: e.amt_in_msat !== undefined ? toSats(e.amt_in_msat) : undefined,
          amountOutMsat: e.amt_out_msat !== undefined ? toSats(e.amt_out_msat) : undefined,
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
    },
  };
}
