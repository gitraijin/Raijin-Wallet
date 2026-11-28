/**
 * The on-chain wallet: BIP84 native SegWit (bc1q…) from the app's 12-word
 * seed (the same words as Cashu), account m/84'/0'/0', so the words restore
 * in any standard wallet (Sparrow, BlueWallet, Electrum with BIP39).
 *
 * Chain data comes from an Electrum server (electrum.ts). Addresses are
 * scanned with a gap limit of 20; only the used counts are kept on the
 * device, everything else is fetched again after a restart.
 */
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

import { seedBytes } from '@/cashu/seed';
import * as SecureStore from '@/lib/secure-store';

import { connectAny, type ElectrumClient, scriptHash } from './electrum';

const GAP = 20;
let NET = btc.NETWORK;
let PATH = "m/84'/0'/0'";

/** Tests only: regtest addresses (bcrt1…) and coin type 1. Never called by the app. */
export function useRegtestForTests() {
  NET = { ...btc.TEST_NETWORK, bech32: 'bcrt' };
  PATH = "m/84'/1'/0'";
}
const STATE_KEY = 'raijin.onchain.state.v1';
const DUST = 546;

type Chain = 0 | 1; // 0 receive, 1 change

export type AddressInfo = { chain: Chain; index: number; address: string; script: Uint8Array; scripthash: string };
export type OnchainUtxo = { txid: string; vout: number; value: number; height: number; address: AddressInfo };
export type OnchainTx = {
  txid: string;
  height: number; // 0 or less = unconfirmed
  /** Net effect on this wallet in sats (positive = received). */
  net: number;
  fee: number | null;
  time: number | null;
  /** Receiving addresses of ours (for incoming), or the destination (outgoing). */
  addresses: string[];
};

type StoredState = { used: [number, number] };

export class OnchainWallet {
  private account: HDKey;
  private addrs = new Map<string, AddressInfo>(); // scripthash -> info
  private byAddress = new Map<string, AddressInfo>();
  private histories = new Map<string, { tx_hash: string; height: number }[]>();
  private txCache = new Map<string, btc.Transaction>();
  private headerTimes = new Map<number, number>();
  /** Highest used index + 1 per chain. */
  private used: [number, number] = [0, 0];
  tip = 0;
  client: ElectrumClient | null = null;

  private constructor(account: HDKey) {
    this.account = account;
  }

  static async open(): Promise<OnchainWallet> {
    const root = HDKey.fromMasterSeed(await seedBytes());
    const wallet = new OnchainWallet(root.derive(PATH));
    try {
      const raw = await SecureStore.getItemAsync(STATE_KEY);
      if (raw) wallet.used = (JSON.parse(raw) as StoredState).used;
    } catch {
      // first start
    }
    return wallet;
  }

  address(chain: Chain, index: number): AddressInfo {
    const key = this.account.deriveChild(chain).deriveChild(index);
    const pay = btc.p2wpkh(key.publicKey!, NET);
    const info: AddressInfo = { chain, index, address: pay.address!, script: pay.script, scripthash: scriptHash(pay.script) };
    if (!this.addrs.has(info.scripthash)) {
      this.addrs.set(info.scripthash, info);
      this.byAddress.set(info.address, info);
    }
    return info;
  }

  private privateKey(info: AddressInfo): Uint8Array {
    return this.account.deriveChild(info.chain).deriveChild(info.index).privateKey!;
  }

  async connect(): Promise<ElectrumClient> {
    if (this.client && !this.client.isClosed) return this.client;
    this.client = await connectAny();
    return this.client;
  }

  disconnect() {
    this.client?.close();
    this.client = null;
  }

  private async saveState() {
    await SecureStore.setItemAsync(STATE_KEY, JSON.stringify({ used: this.used } satisfies StoredState));
  }

  /** Fetches histories of all addresses up to the gap limit on both chains. */
  async sync(): Promise<void> {
    const client = await this.connect();
    const tipHeader = (await client.request('blockchain.headers.subscribe', [])) as { height: number };
    this.tip = tipHeader.height;
    for (const chain of [0, 1] as Chain[]) {
      let start = 0;
      let lastUsed = this.used[chain] - 1;
      // Scan in batches until GAP addresses past the last used one are empty.
      while (start <= lastUsed + GAP) {
        const end = Math.max(lastUsed + GAP, start + GAP - 1);
        const infos: AddressInfo[] = [];
        for (let i = start; i <= end; i++) infos.push(this.address(chain, i));
        const results = await Promise.all(
          infos.map((a) => client.request('blockchain.scripthash.get_history', [a.scripthash]) as Promise<{ tx_hash: string; height: number }[]>),
        );
        results.forEach((h, i) => {
          this.histories.set(infos[i].scripthash, h);
          if (h.length) lastUsed = Math.max(lastUsed, infos[i].index);
        });
        start = end + 1;
      }
      this.used[chain] = lastUsed + 1;
    }
    await this.saveState();
    await this.fetchTransactions();
  }

  private async tx(txid: string): Promise<btc.Transaction> {
    let t = this.txCache.get(txid);
    if (!t) {
      const raw = (await this.client!.request('blockchain.transaction.get', [txid])) as string;
      t = btc.Transaction.fromRaw(hex.decode(raw), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true });
      if (t.id !== txid) throw new Error('server sent a different transaction');
      this.txCache.set(txid, t);
    }
    return t;
  }

  private async fetchTransactions() {
    const ids = new Set<string>();
    for (const h of this.histories.values()) for (const e of h) ids.add(e.tx_hash);
    await Promise.all([...ids].map((id) => this.tx(id)));
  }

  private allHistory(): Map<string, number> {
    const heights = new Map<string, number>();
    for (const h of this.histories.values()) for (const e of h) heights.set(e.tx_hash, e.height);
    return heights;
  }

  /** Our unspent outputs, computed from the transactions (no extra server calls). */
  utxos(): OnchainUtxo[] {
    const heights = this.allHistory();
    const spent = new Set<string>();
    for (const txid of heights.keys()) {
      const t = this.txCache.get(txid);
      if (!t) continue;
      for (let i = 0; i < t.inputsLength; i++) {
        const input = t.getInput(i);
        spent.add(`${hex.encode(input.txid!)}:${input.index}`);
      }
    }
    const out: OnchainUtxo[] = [];
    for (const [txid, height] of heights) {
      const t = this.txCache.get(txid);
      if (!t) continue;
      for (let i = 0; i < t.outputsLength; i++) {
        const o = t.getOutput(i);
        const info = o.script ? this.addrs.get(scriptHash(o.script)) : undefined;
        if (info && !spent.has(`${txid}:${i}`)) out.push({ txid, vout: i, value: Number(o.amount), height, address: info });
      }
    }
    return out;
  }

  balance(): { confirmed: number; unconfirmed: number } {
    let confirmed = 0;
    let unconfirmed = 0;
    for (const u of this.utxos()) {
      if (u.height > 0) confirmed += u.value;
      else unconfirmed += u.value;
    }
    return { confirmed, unconfirmed };
  }

  private async blockTime(height: number): Promise<number | null> {
    if (height <= 0) return null;
    let t = this.headerTimes.get(height);
    if (t === undefined) {
      const header = (await this.client!.request('blockchain.block.header', [height])) as string;
      const b = hex.decode(header);
      t = b[68] | (b[69] << 8) | (b[70] << 16) | (b[71] << 24);
      t = t >>> 0;
      this.headerTimes.set(height, t);
    }
    return t;
  }

  /** History with net amounts, newest first. */
  async history(): Promise<OnchainTx[]> {
    const heights = this.allHistory();
    const list: OnchainTx[] = [];
    for (const [txid, height] of heights) {
      const t = this.txCache.get(txid);
      if (!t) continue;
      let ownIn = 0;
      let allInKnown = true;
      let allIn = 0;
      for (let i = 0; i < t.inputsLength; i++) {
        const input = t.getInput(i);
        const prevId = hex.encode(input.txid!);
        const prev = this.txCache.get(prevId);
        if (!prev) {
          allInKnown = false;
          continue;
        }
        const o = prev.getOutput(input.index!);
        allIn += Number(o.amount);
        if (o.script && this.addrs.has(scriptHash(o.script))) ownIn += Number(o.amount);
      }
      let ownOut = 0;
      let allOut = 0;
      const ours: string[] = [];
      const theirs: string[] = [];
      for (let i = 0; i < t.outputsLength; i++) {
        const o = t.getOutput(i);
        allOut += Number(o.amount);
        const info = o.script ? this.addrs.get(scriptHash(o.script)) : undefined;
        if (info) {
          ownOut += Number(o.amount);
          if (info.chain === 0) ours.push(info.address);
        } else {
          try {
            theirs.push(btc.Address(NET).encode(btc.OutScript.decode(o.script!)));
          } catch {
            // unknown output type
          }
        }
      }
      const net = ownOut - ownIn;
      list.push({
        txid,
        height,
        net,
        fee: ownIn > 0 && allInKnown ? allIn - allOut : null,
        time: await this.blockTime(height).catch(() => null),
        addresses: net >= 0 ? ours : theirs,
      });
    }
    // Unconfirmed first, then newest block first.
    const rank = (h: number) => (h <= 0 ? Number.MAX_SAFE_INTEGER : h);
    return list.sort((a, b) => rank(b.height) - rank(a.height));
  }

  private issued = -1;

  /**
   * The first receive address never used; with `fresh` the next one after the
   * last shown (staying inside the gap limit, so a restore still finds it).
   */
  receiveAddress(fresh: boolean): string {
    if (this.issued < this.used[0]) this.issued = this.used[0];
    else if (fresh) this.issued = Math.min(this.issued + 1, this.used[0] + GAP - 1);
    return this.address(0, this.issued).address;
  }

  private changeAddress(): AddressInfo {
    return this.address(1, this.used[1]);
  }

  /** sat/vB for about 2, 6 and 24 blocks (Electrum gives BTC/kB, -1 when unknown). */
  async feeRates(): Promise<{ fast: number; medium: number; slow: number }> {
    const client = await this.connect();
    const rate = async (blocks: number, fallback: number) => {
      const btcPerKb = (await client.request('blockchain.estimatefee', [blocks]).catch(() => -1)) as number;
      return btcPerKb > 0 ? Math.max(1, Math.round(btcPerKb * 1e5 * 10) / 10) : fallback;
    };
    const [fast, medium, slow] = await Promise.all([rate(2, 5), rate(6, 3), rate(24, 1)]);
    return { fast: Math.max(fast, medium), medium: Math.max(medium, slow), slow };
  }

  /**
   * Builds and signs a transaction. amount null sends everything (no change).
   * `outpoints` restricts the coins (coin control).
   */
  build(opts: { to: string; amount: number | null; feeRate: number; outpoints?: string[] }) {
    // Bech32 may come upper-case from a QR code; outputs compare lower-case.
    if (/^(bc|tb|bcrt)1/i.test(opts.to)) opts = { ...opts, to: opts.to.toLowerCase() };
    btc.Address(NET).decode(opts.to);
    let coins = this.utxos();
    if (opts.outpoints?.length) coins = coins.filter((u) => opts.outpoints!.includes(`${u.txid}:${u.vout}`));
    if (!coins.length) throw new Error('No coins to spend.');
    const inputs = coins.map((u) => ({
      txid: hex.decode(u.txid),
      index: u.vout,
      witnessUtxo: { script: u.address.script, amount: BigInt(u.value) },
    }));
    const sweep = opts.amount === null;
    if (!sweep && (!Number.isInteger(opts.amount) || opts.amount! < DUST)) throw new Error(`At least ${DUST} sats.`);
    const change = this.changeAddress();
    const selected = btc.selectUTXO(inputs, sweep ? [] : [{ address: opts.to, amount: BigInt(opts.amount!) }], sweep ? 'all' : 'default', {
      feePerByte: BigInt(Math.max(1, Math.ceil(opts.feeRate))),
      changeAddress: sweep ? opts.to : change.address,
      createTx: true,
      network: NET,
    });
    if (!selected?.tx) throw new Error('Not enough funds for amount and fee.');
    const tx = selected.tx;
    for (let i = 0; i < tx.inputsLength; i++) {
      const input = tx.getInput(i);
      const info = this.addrs.get(scriptHash(input.witnessUtxo!.script));
      if (!info) throw new Error('unknown input');
      tx.signIdx(this.privateKey(info), i);
    }
    tx.finalize();
    const outputs = selected.outputs.map((o) => ({ address: (o as { address?: string }).address, amount: Number(o.amount) }));
    const sent = outputs.filter((o) => o.address === opts.to).reduce((s, o) => s + o.amount, 0);
    const changeOut = sweep ? 0 : outputs.filter((o) => o.address === change.address).reduce((s, o) => s + o.amount, 0);
    return { hex: tx.hex, txid: tx.id, fee: Number(selected.fee), amount: sent, change: changeOut, vsize: tx.vsize };
  }

  async broadcast(rawHex: string): Promise<string> {
    const client = await this.connect();
    const txid = (await client.request('blockchain.transaction.broadcast', [rawHex])) as string;
    // The change index moves on, so the next change address is fresh.
    this.used[1] += 1;
    await this.saveState();
    return txid;
  }

  /** Calls `onChange` when any of our addresses or the chain tip changes. */
  async watch(onChange: () => void): Promise<() => void> {
    const client = await this.connect();
    const offs = [client.on('blockchain.scripthash.subscribe', () => onChange()), client.on('blockchain.headers.subscribe', () => onChange())];
    const watched = [...this.addrs.values()].filter((a) => a.index < this.used[a.chain] + GAP);
    await Promise.all(watched.map((a) => client.request('blockchain.scripthash.subscribe', [a.scripthash]).catch(() => null)));
    return () => offs.forEach((off) => off());
  }
}
