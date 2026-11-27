import type { WalletPayment } from '@/lightning';

/** Hands a payment object to the detail screen without serializing it into the URL. */
const payments = new Map<string, WalletPayment>();

export function rememberPayment(payment: WalletPayment): void {
  payments.set(payment.id, payment);
}

export function recallPayment(id: string): WalletPayment | undefined {
  return payments.get(id);
}
