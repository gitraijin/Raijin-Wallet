/**
 * App-wide "payment received" events. WalletContext (node payments) and the
 * Cashu screens emit; the toast, haptics and notifications listen.
 */
export type ReceivedPayment = {
  amountSats: bigint;
  source: 'lightning' | 'onchain' | 'cashu';
  description?: string;
};

type Listener = (payment: ReceivedPayment) => void;
const listeners = new Set<Listener>();

export function emitPaymentReceived(payment: ReceivedPayment): void {
  listeners.forEach((l) => l(payment));
}

export function onPaymentReceived(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
