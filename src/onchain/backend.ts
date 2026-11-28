/**
 * The on-chain wallet as a WalletBackend, so screens treat it like any other
 * wallet: balance, history, receive (address), send (prepare → confirm),
 * fee suggestions, coin control. Lightning is not available here.
 *
 * Connection string: raijin-onchain://bip84 (holds no secret; the keys come
 * from the app's seed in secure storage).
 */
import { parsePaymentInput } from '@/lib/bitcoin';
import type { FeeEstimate, OnchainSendRequest, SendQuote, Utxo, WalletBackend, WalletPayment, WalletSnapshot } from '@/lightning/types';

import { OnchainWallet } from './wallet';

export const ONCHAIN_URI = 'raijin-onchain://bip84';

export async function createOnchainBackend(): Promise<WalletBackend> {
  const wallet = await OnchainWallet.open();
  // Verifies that a server is reachable (adding the wallet fails otherwise).
  await wallet.sync();
  let lastSync = new Date();
  let syncing: Promise<void> | null = null;

  const sync = () => {
    if (!syncing) {
      syncing = wallet
        .sync()
        .then(() => {
          lastSync = new Date();
        })
        .finally(() => {
          syncing = null;
        });
    }
    return syncing;
  };

  const quote = (destination: string, draft: ReturnType<OnchainWallet['build']>, rate: number): SendQuote => ({
    kind: 'onchain',
    destination,
    amountSats: BigInt(draft.amount),
    feeSats: BigInt(draft.fee),
    details: [{ key: 'feeRate', text: `${rate} sat/vB` }],
    confirm: async () => {
      const txid = await wallet.broadcast(draft.hex);
      void sync().catch(() => {});
      return { state: 'pending', txid };
    },
  });

  const prepareOnchainSend = async (req: OnchainSendRequest): Promise<SendQuote> => {
    await sync();
    const draft = wallet.build({
      to: req.address,
      amount: req.sendAll ? null : Number(req.amountSats ?? 0n),
      feeRate: req.satPerVbyte,
      outpoints: req.outpoints,
    });
    return quote(req.address, draft, req.satPerVbyte);
  };

  return {
    info: { label: 'bitcoin // on-chain', network: 'mainnet', sendTargets: ['bitcoin'], onchainReceive: true },

    async getSnapshot(): Promise<WalletSnapshot> {
      await sync();
      const { confirmed, unconfirmed } = wallet.balance();
      const history = await wallet.history();
      const payments: WalletPayment[] = history.map((tx) => {
        const out = tx.net < 0;
        const fee = out ? (tx.fee ?? 0) : 0;
        return {
          id: tx.txid,
          direction: out ? 'out' : 'in',
          state: tx.height > 0 ? 'complete' : 'pending',
          rail: 'onchain',
          amountSats: BigInt(out ? -tx.net - fee : tx.net),
          feeSats: BigInt(fee),
          timestamp: tx.time ?? Math.floor(lastSync.getTime() / 1000),
          txid: tx.txid,
          confirmations: tx.height > 0 ? wallet.tip - tx.height + 1 : 0,
          addresses: tx.addresses,
        };
      });
      return {
        balanceSats: BigInt(confirmed),
        breakdown: { lightningSats: 0n, onchainSats: BigInt(confirmed), onchainPendingSats: BigInt(unconfirmed) },
        payments,
        lastSyncedAt: lastSync,
      };
    },

    async createInvoice() {
      throw new Error('This is an on-chain wallet: receive with a bitcoin address.');
    },

    async getOnchainAddress(fresh: boolean) {
      return wallet.receiveAddress(fresh);
    },

    async estimateFees(): Promise<FeeEstimate[]> {
      const r = await wallet.feeRates();
      return [
        { speed: 'fast', targetBlocks: 2, satPerVbyte: r.fast },
        { speed: 'medium', targetBlocks: 6, satPerVbyte: r.medium },
        { speed: 'slow', targetBlocks: 24, satPerVbyte: r.slow },
      ];
    },

    async prepareSend(request) {
      const input = parsePaymentInput(request.destination);
      if (input.type !== 'onchain') throw new Error('This is an on-chain wallet: paste a bitcoin address.');
      const rates = await wallet.feeRates();
      return prepareOnchainSend({
        address: input.address,
        amountSats: request.amountSats ?? input.amountSats,
        sendAll: false,
        satPerVbyte: rates.medium,
      });
    },

    prepareOnchainSend,

    async listUtxos(): Promise<Utxo[]> {
      await sync();
      return wallet.utxos().map((u) => ({
        outpoint: `${u.txid}:${u.vout}`,
        amountSats: BigInt(u.value),
        address: u.address.address,
        confirmations: u.height > 0 ? wallet.tip - u.height + 1 : 0,
      }));
    },

    async subscribe(onChange) {
      let stop: (() => void) | null = null;
      let alive = true;
      // Reconnect when the server goes away (another server is tried).
      const start = async () => {
        try {
          stop = await wallet.watch(onChange);
          if (wallet.client) {
            wallet.client.onClose = () => {
              if (!alive) return;
              setTimeout(() => {
                if (alive) void sync().then(start, () => setTimeout(start, 30_000));
              }, 3000);
            };
          }
        } catch {
          if (alive) setTimeout(start, 30_000);
        }
      };
      await start();
      return () => {
        alive = false;
        stop?.();
      };
    },

    async disconnect() {
      wallet.disconnect();
    },
  };
}
