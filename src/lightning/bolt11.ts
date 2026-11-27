import { decodeInvoice } from '@getalby/lightning-tools/bolt11';

export type CheckedInvoice = {
  invoice: string;
  amountSats: bigint;
  /** true if the invoice has no amount and the user supplied one. */
  zeroAmount: boolean;
  description: string | undefined;
};

/**
 * Validates a BOLT11 invoice for sending through a remote backend
 * (NWC, LNDHub, LND REST) and resolves the amount to pay.
 */
export function checkInvoice(destination: string, userAmountSats: bigint | undefined): CheckedInvoice {
  const decoded = decodeInvoice(destination);
  if (!decoded) throw new Error('Only BOLT11 lightning invoices are supported with this connection.');
  if (decoded.expiry !== undefined && decoded.timestamp + decoded.expiry < Date.now() / 1000) {
    throw new Error('This invoice has expired.');
  }

  const invoiceSats = BigInt(decoded.satoshi);
  const zeroAmount = invoiceSats === 0n;
  if (zeroAmount && !userAmountSats) throw new Error('This invoice has no amount. Enter one.');

  return {
    invoice: destination,
    amountSats: zeroAmount ? userAmountSats! : invoiceSats,
    zeroAmount,
    description: decoded.description,
  };
}
