import {
  getEncodedToken,
  getTokenMetadata,
  HttpResponseError,
  JSONInt,
  MeltQuoteState,
  Mint,
  MintOperationError,
  MintQuoteState,
  normalizeMintUrl,
  type Proof,
  type RequestFn,
  sumProofs,
  Wallet,
} from '@cashu/cashu-ts';

import { onNamespaceChange } from '@/lib/storage-namespace';
import { rawRequest } from '@/lightning/http';
import type { WalletBackend } from '@/lightning/types';

import { counters, seedBytes } from './seed';
import * as store from './store';
import type { CashuEntry, CashuMint } from './store';

/**
 * Cashu operations. Every proof-changing operation runs under one lock, reads
 * the proofs from the store, talks to the mint and writes the result back, so
 * the same proof is never spent twice by two screens at once.
 *
 * Secrets are derived from the Cashu seed (NUT-13, see seed.ts), so proofs
 * can be restored from the mint (NUT-09) after losing the device. The order of writes is chosen so that a crash or lost response at worst
 * leaves spent proofs behind (cleaned up by `reconcile`), never drops
 * unspent ones.
 */

const UNIT = 'sat';

/* ------------------------------------------------------------------ */
/* Transport: all mint requests go through http.ts (Tor, desktop)      */
/* ------------------------------------------------------------------ */

const mintRequest: RequestFn = async <T = unknown>(args: Parameters<RequestFn>[0]): Promise<T> => {
  const body = args.requestBody ? JSONInt.stringify(args.requestBody) : undefined;
  const method = (args.method?.toUpperCase() ?? (body ? 'POST' : 'GET')) as 'GET' | 'POST';
  const response = await rawRequest(args.endpoint, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...args.headers,
    },
    body,
    timeoutMs: 30_000,
  });
  let data: Record<string, unknown> = {};
  try {
    data = response.text ? (JSONInt.parse(response.text) as Record<string, unknown>) : {};
  } catch {
    if (response.ok) throw new HttpResponseError('Unexpected response from the mint', response.status);
  }
  if (!response.ok) {
    if (typeof data.code === 'number' && typeof data.detail === 'string') {
      throw new MintOperationError(data.code, data.detail);
    }
    const message =
      typeof data.error === 'string'
        ? data.error
        : typeof data.detail === 'string'
          ? data.detail
          : `HTTP ${response.status}`;
    throw new HttpResponseError(message, response.status);
  }
  return data as T;
};

/* ------------------------------------------------------------------ */
/* Wallet instances and lock                                           */
/* ------------------------------------------------------------------ */

const wallets = new Map<string, Promise<Wallet>>();

function walletFor(url: string): Promise<Wallet> {
  let pending = wallets.get(url);
  if (!pending) {
    pending = (async () => {
      // Deterministic secrets from the Cashu seed (NUT-13), restorable via NUT-09.
      const wallet = new Wallet(new Mint(url, { customRequest: mintRequest }), {
        unit: UNIT,
        bip39seed: await seedBytes(),
        counterSource: counters,
      });
      await wallet.loadMint();
      return wallet;
    })();
    wallets.set(url, pending);
    pending.catch(() => wallets.delete(url));
  }
  return pending;
}

/** Drops cached wallets, e.g. after the seed was replaced. */
export function resetWallets(): void {
  wallets.clear();
}

onNamespaceChange(resetWallets);

let chain: Promise<unknown> = Promise.resolve();

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const sats = (proofs: Pick<Proof, 'amount'>[]): bigint => sumProofs(proofs).toBigInt();

/* ------------------------------------------------------------------ */
/* Mints                                                               */
/* ------------------------------------------------------------------ */

export type MintPreview = { url: string; name: string; description?: string };

/** Contacts a mint and checks that it can mint and melt sats over Lightning. */
export async function inspectMint(input: string): Promise<MintPreview> {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = normalizeMintUrl(url);
  const wallet = await walletFor(url);
  const info = wallet.getMintInfo();
  if (!info.supportsMintMeltMethod('mint', 'bolt11', UNIT) || !info.supportsMintMeltMethod('melt', 'bolt11', UNIT)) {
    throw new Error('This mint does not support sat over Lightning.');
  }
  const raw = info.cache;
  return { url, name: raw.name || hostOf(url), description: raw.description };
}

export function hostOf(url: string): string {
  return url.replace(/^\w+:\/\//, '').split(/[/?#]/)[0];
}

export async function balanceOf(mintId: string): Promise<bigint> {
  return sats(await store.loadProofs(mintId));
}

/* ------------------------------------------------------------------ */
/* Deposit (mint): Lightning -> ecash                                  */
/* ------------------------------------------------------------------ */

export async function createMintQuote(mint: CashuMint, amountSats: bigint): Promise<CashuEntry> {
  const wallet = await walletFor(mint.url);
  const quote = await wallet.createMintQuoteBolt11(amountSats);
  return store.addEntry({
    mintId: mint.id,
    kind: 'mint',
    state: 'pending',
    amount: amountSats.toString(),
    fee: '0',
    quote: quote.quote,
    invoice: quote.request,
    expiry: quote.expiry,
  });
}

/**
 * Checks a pending deposit and mints the ecash once the invoice is paid.
 * Returns the entry's new state.
 */
export function checkMintQuote(mint: CashuMint, entry: CashuEntry): Promise<CashuEntry['state']> {
  return locked(async () => {
    const current = (await store.loadHistory()).find((e) => e.id === entry.id);
    if (!current || current.state !== 'pending' || !current.quote) return current?.state ?? 'failed';
    const wallet = await walletFor(mint.url);
    const quote = await wallet.checkMintQuoteBolt11(current.quote);
    if (quote.state === MintQuoteState.PAID) {
      const proofs = await wallet.mintProofsBolt11(BigInt(current.amount), quote);
      await store.addProofs(mint.id, proofs);
      await store.updateEntry(current.id, { state: 'complete', invoice: undefined });
      return 'complete';
    }
    if (quote.state === MintQuoteState.ISSUED) {
      // Issued, but not by this attempt: the response was lost earlier.
      await store.updateEntry(current.id, { state: 'failed', invoice: undefined });
      return 'failed';
    }
    const expired = current.expiry ? current.expiry * 1000 < Date.now() : false;
    if (expired) {
      await store.updateEntry(current.id, { state: 'failed', invoice: undefined });
      return 'failed';
    }
    return 'pending';
  });
}

/** Pays a deposit invoice with the connected node, then mints the ecash. */
export async function payMintQuoteWithNode(
  mint: CashuMint,
  entry: CashuEntry,
  backend: WalletBackend,
): Promise<CashuEntry['state']> {
  if (!entry.invoice) throw new Error('No invoice');
  const quote = await backend.prepareSend({ destination: entry.invoice });
  const result = await quote.confirm();
  if (result.state === 'failed') throw new Error('The node could not pay the invoice.');
  // The mint may need a moment to see the payment.
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await checkMintQuote(mint, entry);
    if (state !== 'pending') return state;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return 'pending';
}

/* ------------------------------------------------------------------ */
/* Withdraw (melt): ecash -> Lightning                                 */
/* ------------------------------------------------------------------ */

export type MeltPreview = {
  mint: CashuMint;
  invoice: string;
  quoteId: string;
  amountSats: bigint;
  /** Lightning fee the mint reserves; unused reserve comes back as change. */
  feeReserveSats: bigint;
  /** Proof input fees for spending (NUT-02), estimated. */
  inputFeeSats: bigint;
  /** Most this mint's ecash can pay with this quote's fee reserve. */
  spendableSats: bigint;
};

export async function prepareMelt(mint: CashuMint, invoice: string): Promise<MeltPreview> {
  const wallet = await walletFor(mint.url);
  const clean = invoice.trim().replace(/^lightning:/i, '');
  const quote = await wallet.createMeltQuoteBolt11(clean);
  const proofs = await store.loadProofs(mint.id);
  const amount = quote.amount.toBigInt();
  const reserve = quote.fee_reserve.toBigInt();
  const spendable = wallet.maxSpendableAfterFees(proofs, quote.fee_reserve).toBigInt();
  return {
    mint,
    invoice: clean,
    quoteId: quote.quote,
    amountSats: amount,
    feeReserveSats: reserve,
    inputFeeSats: wallet.getFeesToInclude(amount + reserve).toBigInt(),
    spendableSats: spendable,
  };
}

export type MeltResult = { state: 'complete' | 'pending'; feeSats: bigint; preimage: string | null };

export function executeMelt(preview: MeltPreview): Promise<MeltResult> {
  return locked(async () => {
    const { mint } = preview;
    const wallet = await walletFor(mint.url);
    const quote = await wallet.checkMeltQuoteBolt11(preview.quoteId);
    if (quote.state !== MeltQuoteState.UNPAID) throw new Error('This quote was already used.');
    const proofs = await store.loadProofs(mint.id);
    const total = quote.amount.add(quote.fee_reserve);
    const { keep, send } = await wallet.send(total, proofs, { includeFees: true });
    // After the swap the old proofs are spent and keep + send are the new set.
    await store.saveProofs(mint.id, [...keep, ...send]);
    const before = sats(proofs);
    try {
      const response = await wallet.meltProofsBolt11(quote, send);
      const paid = response.quote.state === MeltQuoteState.PAID;
      const change = response.change ?? [];
      if (paid) await store.saveProofs(mint.id, [...keep, ...change]);
      // Everything that left the wallet beyond the invoice amount: swap and
      // Lightning fees minus returned change.
      const fee = before - sats(keep) - sats(change) - preview.amountSats;
      await store.addEntry({
        mintId: mint.id,
        kind: 'melt',
        state: paid ? 'complete' : 'pending',
        amount: preview.amountSats.toString(),
        fee: (fee > 0n ? fee : 0n).toString(),
        quote: paid ? undefined : quote.quote,
      });
      return { state: paid ? 'complete' : 'pending', feeSats: fee > 0n ? fee : 0n, preimage: response.quote.payment_preimage };
    } catch (error) {
      await reconcileUnlocked(mint);
      throw error;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export type TokenPreview = { mintUrl: string; amountSats: bigint; memo?: string; unit: string };

export function inspectToken(token: string): TokenPreview {
  const meta = getTokenMetadata(cleanToken(token));
  return { mintUrl: normalizeMintUrl(meta.mint), amountSats: meta.amount.toBigInt(), memo: meta.memo, unit: meta.unit };
}

export function cleanToken(token: string): string {
  return token.trim().replace(/^cashu:/i, '');
}

export function isCashuToken(value: string): boolean {
  return /^(cashu:)?cashu[AB][A-Za-z0-9_\-+/=]+$/i.test(value.trim());
}

/** Swaps a received token at its mint; the mint must already be in the list. */
export function receiveToken(mint: CashuMint, token: string): Promise<{ amountSats: bigint; feeSats: bigint }> {
  return locked(async () => {
    const clean = cleanToken(token);
    const meta = getTokenMetadata(clean);
    if (meta.unit !== UNIT) throw new Error(`Unsupported unit: ${meta.unit}`);
    if (normalizeMintUrl(meta.mint) !== mint.url) throw new Error('The token belongs to another mint.');
    const wallet = await walletFor(mint.url);
    const proofs = await wallet.receive(clean);
    await store.addProofs(mint.id, proofs);
    const received = sats(proofs);
    const fee = meta.amount.toBigInt() - received;
    await store.addEntry({
      mintId: mint.id,
      kind: 'receive',
      state: 'complete',
      amount: received.toString(),
      fee: (fee > 0n ? fee : 0n).toString(),
      memo: meta.memo,
    });
    return { amountSats: received, feeSats: fee > 0n ? fee : 0n };
  });
}

/** Creates a token worth `amountSats` for the receiver (we pay their swap fee). */
export function sendToken(mint: CashuMint, amountSats: bigint, memo?: string): Promise<CashuEntry> {
  return locked(async () => {
    const wallet = await walletFor(mint.url);
    const proofs = await store.loadProofs(mint.id);
    const { keep, send } = await wallet.send(amountSats, proofs, { includeFees: true });
    const token = getEncodedToken({ mint: mint.url, proofs: send, unit: UNIT, memo: memo || undefined });
    // Token first: if the app dies in between, the proofs exist twice (cleaned
    // up later) instead of not at all.
    const entry = await store.addEntry({
      mintId: mint.id,
      kind: 'send',
      state: 'pending',
      amount: amountSats.toString(),
      // Receiver's swap fee (included in the token) plus our own swap fee.
      fee: (sats(proofs) - sats(keep) - amountSats).toString(),
      token,
      memo: memo || undefined,
    });
    await store.saveProofs(mint.id, keep);
    return entry;
  });
}

/** Takes an unclaimed token back into the wallet. */
export function reclaimToken(mint: CashuMint, entry: CashuEntry): Promise<void> {
  return locked(async () => {
    if (!entry.token) throw new Error('No token');
    const wallet = await walletFor(mint.url);
    const proofs = await wallet.receive(entry.token);
    await store.addProofs(mint.id, proofs);
    await store.updateEntry(entry.id, { state: 'reclaimed', token: undefined });
  });
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

async function reconcileUnlocked(mint: CashuMint): Promise<void> {
  const wallet = await walletFor(mint.url);
  const proofs = await store.loadProofs(mint.id);
  if (proofs.length > 0) {
    const { unspent, pending } = await wallet.groupProofsByState(proofs);
    if (unspent.length + pending.length !== proofs.length) {
      await store.saveProofs(mint.id, [...unspent, ...pending]);
    }
  }
  // Sent tokens: complete once the receiver has swapped them.
  const history = await store.loadHistory();
  for (const entry of history) {
    if (entry.mintId !== mint.id || entry.state !== 'pending') continue;
    if (entry.kind === 'send' && entry.token) {
      const tokenProofs = wallet.decodeToken(entry.token).proofs;
      const { unspent, pending } = await wallet.groupProofsByState(tokenProofs);
      if (unspent.length === 0 && pending.length === 0) {
        await store.updateEntry(entry.id, { state: 'complete', token: undefined });
      }
    }
    // Withdrawals the mint was still paying when we last asked.
    if (entry.kind === 'melt' && entry.quote) {
      const quote = await wallet.checkMeltQuoteBolt11(entry.quote);
      if (quote.state === MeltQuoteState.PAID) {
        await store.updateEntry(entry.id, { state: 'complete', quote: undefined });
      } else if (quote.state === MeltQuoteState.UNPAID) {
        await store.updateEntry(entry.id, { state: 'failed', quote: undefined });
      }
    }
  }
}

/** Drops spent proofs and settles sent tokens and pending deposits. */
export async function reconcile(mint: CashuMint): Promise<void> {
  await locked(() => reconcileUnlocked(mint));
  const history = await store.loadHistory();
  for (const entry of history) {
    if (entry.mintId === mint.id && entry.kind === 'mint' && entry.state === 'pending') {
      await checkMintQuote(mint, entry).catch(() => {});
    }
  }
}

/* ------------------------------------------------------------------ */
/* Restore (NUT-09)                                                    */
/* ------------------------------------------------------------------ */

export type RestoreResult = { url: string; amountSats: bigint; proofs: number };

/** 0..1 for one mint; called after every batch so the screen can show it. */
export type RestoreProgress = (fraction: number) => void;

/** Outputs per /v1/restore request. Small, so the UI gets a frame between batches. */
const RESTORE_BATCH = 50;
/** Stop after this many consecutive counters without a signature (NUT-13). */
const RESTORE_GAP = 300;

/** Lets React render: deriving outputs is pure-JS crypto and blocks the JS thread. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Asks a mint for every signature it ever gave to outputs derived from the
 * current seed, keeps the unspent proofs and moves the counters past them.
 */
export function restoreFromMint(mint: CashuMint, onProgress?: RestoreProgress): Promise<RestoreResult> {
  return locked(async () => {
    const wallet = await walletFor(mint.url);
    const found: Proof[] = [];
    const keysets = wallet.keyChain.getKeysets().filter((k) => k.unit === UNIT);
    const emptyNeeded = Math.ceil(RESTORE_GAP / RESTORE_BATCH);
    let shown = 0;
    const report = (fraction: number) => {
      // A hit resets the empty streak; never let the bar run backwards.
      shown = Math.max(shown, Math.min(1, fraction));
      onProgress?.(shown);
    };
    report(0);
    for (const [index, keyset] of keysets.entries()) {
      await wallet.keyChain.ensureKeysetKeys(keyset.id);
      let start = 0;
      let empty = 0;
      let last: number | undefined;
      while (empty < emptyNeeded) {
        await nextFrame();
        const batch = await wallet.restore(start, RESTORE_BATCH, { keysetId: keyset.id });
        if (batch.lastCounterWithSignature !== undefined) {
          empty = 0;
          last = batch.lastCounterWithSignature;
          found.push(...batch.proofs);
        } else {
          empty++;
        }
        start += RESTORE_BATCH;
        report((index + empty / emptyNeeded) / keysets.length);
      }
      if (last !== undefined) await counters.advanceToAtLeast(keyset.id, last + 1);
    }
    if (found.length === 0) {
      report(1);
      return { url: mint.url, amountSats: 0n, proofs: 0 };
    }
    const { unspent } = await wallet.groupProofsByState(found);
    await store.addProofs(mint.id, unspent);
    if (unspent.length > 0) {
      await store.addEntry({
        mintId: mint.id,
        kind: 'receive',
        state: 'complete',
        amount: sats(unspent).toString(),
        fee: '0',
        memo: 'restore',
      });
    }
    report(1);
    return { url: mint.url, amountSats: sats(unspent), proofs: unspent.length };
  });
}
