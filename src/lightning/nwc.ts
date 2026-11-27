/**
 * Nostr Wallet Connect (NIP-47) backend. The wallet itself runs elsewhere
 * (own node, Alby Hub, ...); this app only holds a connection secret.
 */
import { NWCClient, type Nip47Transaction } from '@getalby/sdk/nwc';

import { checkInvoice } from './bolt11';
import { detectConnection } from './connection';
import type { PaymentState, WalletBackend, WalletPayment } from './types';

const PAYMENT_PAGE_SIZE = 50;

const msatToSat = (msat: number): bigint => BigInt(Math.floor(msat / 1000));

function toState(state: Nip47Transaction['state']): PaymentState {
  if (state === 'settled') return 'complete';
  if (state === 'failed') return 'failed';
  return 'pending';
}

function toWalletPayment(tx: Nip47Transaction): WalletPayment {
  return {
    id: tx.payment_hash || tx.invoice,
    direction: tx.type === 'incoming' ? 'in' : 'out',
    state: toState(tx.state),
    rail: 'lightning',
    amountSats: msatToSat(tx.amount),
    feeSats: msatToSat(tx.fees_paid ?? 0),
    timestamp: tx.settled_at || tx.created_at,
    description: tx.description || undefined,
    paymentHash: tx.payment_hash || undefined,
    preimage: tx.preimage || undefined,
    invoice: tx.invoice || undefined,
  };
}

const HISTORY_PAGE_SIZE = 100;

export async function createNwcBackend(uri: string): Promise<WalletBackend> {
  if (detectConnection(uri) !== 'nwc') throw new Error('Not a nostr+walletconnect:// URI');

  const client = new NWCClient({ nostrWalletConnectUrl: uri.trim() });
  try {
    // Fails fast on unreachable relays or revoked connections.
    const info = await client.getInfo();
    const can = (method: string) => info.methods.includes(method as never);

    return {
      info: {
        label: info.alias ? `nwc // ${info.alias}` : 'nwc',
        network: info.network || null,
        sendTargets: ['lightning'],
        onchainReceive: false,
      },

      async getSnapshot() {
        const [balance, list] = await Promise.all([
          can('get_balance') ? client.getBalance() : Promise.resolve({ balance: 0 }),
          // Some wallets advertise list_transactions but answer with an error;
          // the balance still matters, so a failing list must not hide it.
          can('list_transactions')
            ? client.listTransactions({ limit: PAYMENT_PAGE_SIZE }).catch((error: unknown) => {
                console.warn('[nwc] list_transactions failed', error);
                return { transactions: [] as Nip47Transaction[] };
              })
            : Promise.resolve({ transactions: [] as Nip47Transaction[] }),
        ]);
        return {
          balanceSats: msatToSat(balance.balance),
          breakdown: null,
          payments: list.transactions.map(toWalletPayment),
          lastSyncedAt: new Date(),
        };
      },

      async createInvoice({ amountSats, description }) {
        // NIP-47 requires an amount; 0 is an "any amount" invoice where the wallet supports it.
        const tx = await client.makeInvoice({
          amount: Number(amountSats ?? 0n) * 1000,
          description: description || undefined,
        });
        return { invoice: tx.invoice, feeSats: 0n };
      },

      ...(can('list_transactions')
        ? {
            async history(cursor: string | null) {
              const offset = cursor ? Number(cursor) : 0;
              const list = await client.listTransactions({ limit: HISTORY_PAGE_SIZE, offset });
              return {
                payments: list.transactions.map(toWalletPayment),
                cursor: list.transactions.length === HISTORY_PAGE_SIZE ? String(offset + HISTORY_PAGE_SIZE) : null,
              };
            },
          }
        : {}),

      ...(can('lookup_invoice')
        ? {
            async lookupInvoice(paymentHash: string) {
              const tx = await client.lookupInvoice({ payment_hash: paymentHash });
              if (tx.state === 'settled') return 'paid' as const;
              if (tx.state === 'failed') return 'canceled' as const;
              return tx.expires_at && tx.expires_at * 1000 < Date.now() ? ('expired' as const) : ('open' as const);
            },
          }
        : {}),

      async getOnchainAddress() {
        throw new Error('On-chain is not available over NWC.');
      },

      async prepareSend({ destination, amountSats }) {
        const { amountSats: amount, zeroAmount } = checkInvoice(destination, amountSats);

        return {
          kind: 'lightning',
          destination,
          amountSats: amount,
          feeSats: undefined, // routing fee is only known after the payment
          confirm: async () => {
            await client.payInvoice({
              invoice: destination,
              amount: zeroAmount ? Number(amount) * 1000 : undefined,
            });
            // pay_invoice only resolves once the payment succeeded.
            return { state: 'complete' };
          },
        };
      },

      async subscribe(onChange) {
        if (!info.notifications?.length) return () => {};
        try {
          return await client.subscribeNotifications(() => onChange(), [
            'payment_received',
            'payment_sent',
          ]);
        } catch (error) {
          console.warn('[nwc] notifications unavailable', error);
          return () => {};
        }
      },

      async disconnect() {
        client.close();
      },
    };
  } catch (error) {
    client.close();
    throw error;
  }
}
