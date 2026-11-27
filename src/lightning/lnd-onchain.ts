/**
 * On-chain wallet of an LND node over REST: history and sending.
 * https://lightning.engineering/api-docs/api/lnd/
 */
import { toSats } from './http';
import type { LndRest } from './lnd-channels';
import type { OnchainSendRequest, SendQuote, Utxo, WalletPayment } from './types';

type Int64 = string | number;

type LndTransaction = {
  tx_hash: string;
  dest_addresses?: string[];
  output_details?: { output_index?: Int64; is_our_address?: boolean; amount?: Int64; address?: string }[];
  /** Net change of the wallet balance; negative for outgoing (fee included). */
  amount?: Int64;
  num_confirmations?: number;
  time_stamp?: Int64;
  total_fees?: Int64;
  label?: string;
};

type LndUtxo = {
  address_type?: string;
  address?: string;
  amount_sat?: Int64;
  confirmations?: Int64;
  outpoint?: { txid_str?: string; output_index?: Int64 };
};

const outpointOf = (u: LndUtxo) => `${u.outpoint?.txid_str ?? ''}:${u.outpoint?.output_index ?? 0}`;

/** Rough input sizes in vbytes per script type, for sweep fee estimates. */
const INPUT_VBYTES: Record<string, number> = {
  WITNESS_PUBKEY_HASH: 68,
  NESTED_PUBKEY_HASH: 91,
  TAPROOT_PUBKEY: 58,
};
const TX_OVERHEAD_VBYTES = 11;
/** Largest common output (P2TR / P2WSH), so the estimate errs on the high side. */
const OUTPUT_VBYTES = 43;
/** Size of a typical 1-in-2-out P2WPKH spend, if the node's estimate has no rate. */
const FALLBACK_VBYTES = 141;

export async function listLndOnchain(rest: LndRest): Promise<WalletPayment[]> {
  const data = await rest<{ transactions?: LndTransaction[] }>('/v1/transactions');
  return (data.transactions ?? []).map((tx) => {
    const net = toSats(tx.amount);
    const fee = toSats(tx.total_fees);
    const out = net < 0n;
    const gross = out ? -net : net;
    return {
      id: tx.tx_hash,
      direction: out ? 'out' : 'in',
      state: (tx.num_confirmations ?? 0) > 0 ? 'complete' : 'pending',
      rail: 'onchain',
      // For outgoing transactions the fee is shown separately.
      amountSats: out && gross > fee ? gross - fee : gross,
      feeSats: out ? fee : 0n,
      timestamp: Number(tx.time_stamp ?? 0),
      description: tx.label || undefined,
      txid: tx.tx_hash,
      confirmations: tx.num_confirmations ?? 0,
      addresses: tx.dest_addresses,
    };
  });
}

/** Spendable coins (unconfirmed included, so coin control can show them). */
export async function listLndUtxos(rest: LndRest): Promise<Utxo[]> {
  const data = await rest<{ utxos?: LndUtxo[] }>('/v1/utxos?min_confs=0&max_confs=2147483647');
  return (data.utxos ?? [])
    .map((u) => ({
      outpoint: outpointOf(u),
      amountSats: toSats(u.amount_sat),
      address: u.address ?? '',
      confirmations: Number(u.confirmations ?? 0),
    }))
    .sort((a, b) => (b.amountSats > a.amountSats ? 1 : -1));
}

/**
 * Speeds up an unconfirmed transaction of this wallet: the node's sweeper
 * spends one of our outputs with a higher fee rate (CPFP). Works for
 * incoming payments and for the change of our own sends.
 */
export async function bumpLndFee(rest: LndRest, txid: string, satPerVbyte: number): Promise<void> {
  const data = await rest<{ transactions?: LndTransaction[] }>('/v1/transactions');
  const tx = (data.transactions ?? []).find((t) => t.tx_hash === txid);
  if (!tx) throw new Error('Transaction not found in the node wallet.');
  if ((tx.num_confirmations ?? 0) > 0) throw new Error('The transaction is already confirmed.');
  const ours = (tx.output_details ?? [])
    .filter((o) => o.is_our_address)
    .sort((a, b) => Number(toSats(b.amount) - toSats(a.amount)))[0];
  if (!ours) throw new Error('This transaction has no output of this wallet to bump from.');
  await rest('/v2/wallet/bumpfee', {
    method: 'POST',
    body: {
      outpoint: { txid_str: txid, output_index: Number(ours.output_index ?? 0) },
      sat_per_vbyte: String(Math.max(1, Math.round(satPerVbyte))),
    },
  });
}

async function sweepEstimate(rest: LndRest, satPerVbyte: number, outpoints?: string[]) {
  const data = await rest<{ utxos?: LndUtxo[] }>('/v1/utxos?min_confs=1&max_confs=2147483647');
  const selected = outpoints?.length ? new Set(outpoints) : null;
  const utxos = (data.utxos ?? []).filter((u) => !selected || selected.has(outpointOf(u)));
  if (utxos.length === 0) throw new Error('No confirmed on-chain funds to send.');
  const total = utxos.reduce((sum, u) => sum + toSats(u.amount_sat), 0n);
  const vbytes =
    TX_OVERHEAD_VBYTES +
    OUTPUT_VBYTES +
    utxos.reduce((sum, u) => sum + (INPUT_VBYTES[u.address_type ?? ''] ?? 68), 0);
  const fee = BigInt(Math.ceil(vbytes * satPerVbyte));
  if (fee >= total) throw new Error('The on-chain balance does not cover the fee.');
  return { amount: total - fee, fee };
}

async function spendEstimate(rest: LndRest, address: string, amount: bigint, satPerVbyte: number) {
  // The node estimates for a confirmation target; its fee/rate ratio gives the
  // transaction size, which is then priced at the rate the user picked.
  const query = `AddrToAmount[${encodeURIComponent(address)}]=${amount.toString()}&target_conf=6`;
  const data = await rest<{ fee_sat?: Int64; sat_per_vbyte?: Int64 }>(`/v1/transactions/fee?${query}`);
  const nodeFee = Number(toSats(data.fee_sat));
  const nodeRate = Number(toSats(data.sat_per_vbyte));
  const vbytes = nodeFee > 0 && nodeRate > 0 ? nodeFee / nodeRate : FALLBACK_VBYTES;
  return BigInt(Math.ceil(vbytes * satPerVbyte));
}

export async function prepareLndOnchainSend(
  rest: LndRest,
  request: OnchainSendRequest,
): Promise<SendQuote> {
  const rate = Math.max(1, Math.round(request.satPerVbyte));
  let amountSats: bigint;
  let feeSats: bigint;

  if (request.sendAll) {
    const sweep = await sweepEstimate(rest, rate, request.outpoints);
    amountSats = sweep.amount;
    feeSats = sweep.fee;
  } else {
    if (!request.amountSats || request.amountSats <= 0n) throw new Error('Enter an amount.');
    amountSats = request.amountSats;
    feeSats = await spendEstimate(rest, request.address, amountSats, rate);
  }

  return {
    kind: 'onchain',
    destination: request.address,
    amountSats,
    feeSats,
    feeEstimated: true,
    details: [{ key: 'feeRate', text: `${rate} sat/vB` }],
    confirm: async () => {
      const result = await rest<{ txid?: string }>('/v1/transactions', {
        method: 'POST',
        body: {
          addr: request.address,
          ...(request.sendAll ? { send_all: true } : { amount: amountSats.toString() }),
          sat_per_vbyte: String(rate),
          ...(request.label ? { label: request.label.slice(0, 500) } : {}),
          // Coin control: only these coins are spent.
          ...(request.outpoints?.length
            ? {
                outpoints: request.outpoints.map((o) => {
                  const [txid_str, index] = o.split(':');
                  return { txid_str, output_index: Number(index) };
                }),
              }
            : {}),
        },
        timeoutMs: 60_000,
      });
      return { state: 'pending', txid: result.txid };
    },
  };
}
