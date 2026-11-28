/**
 * Electrum protocol client (Fulcrum, electrs, ElectrumX) for the on-chain
 * wallet: newline-delimited JSON-RPC over TCP/TLS, opened by the native
 * module (Android) or the desktop main process, over Tor when "Tor for
 * everything" is on or the server is an .onion.
 *
 * Servers are tried in order: the user's own, then RaijinHub's, then public
 * ones. Every server must prove it serves Bitcoin mainnet (genesis block)
 * before it is used. Self-signed certificates are accepted on first use and
 * then pinned (trust on first use, like Electrum and Sparrow).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { RaijinTor } from '../../modules/raijin-tor';
import { isTorForAll } from '@/lightning/http';
import * as SecureStore from '@/lib/secure-store';

export type ElectrumServer = { host: string; port: number; tls: boolean };

/** RaijinHub's Fulcrum (Raitaro behind vps01), then public servers that answered when checked (2026-11-28). */
export const DEFAULT_SERVERS: ElectrumServer[] = [
  { host: 'electrum.raijinhub.com', port: 50002, tls: true },
  { host: 'fulcrum.grey.pw', port: 51002, tls: true },
  { host: 'electrum.acinq.co', port: 50002, tls: true },
  { host: 'bitcoin.lukechilds.co', port: 50002, tls: true },
];

let GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

/** How lines get to the server: the native module, or a stand-in in tests. */
export type Transport = {
  socketOpen(id: string, host: string, port: number, tls: boolean, viaTor: boolean, pin: string | null): Promise<string>;
  socketSend(id: string, line: string): boolean;
  socketClose(id: string): void;
  addListener(event: 'onSocket', listener: (e: { id: string; type: 'data' | 'close'; data?: string; reason?: string }) => void): { remove: () => void };
};
let transport: Transport | null = RaijinTor;
let servers = DEFAULT_SERVERS;

/** Tests only (regtest): another genesis block, server list and transport. Never called by the app. */
export function configureForTests(opts: { genesis: string; servers: ElectrumServer[]; transport: Transport }) {
  GENESIS = opts.genesis;
  servers = opts.servers;
  transport = opts.transport;
}
const PINS_KEY = 'raijin.onchain.electrumPins.v1';
const SERVER_KEY = 'raijin.onchain.electrumServer.v1';

export function serverLabel(s: ElectrumServer): string {
  return `${s.tls ? 'ssl' : 'tcp'}://${s.host}:${s.port}`;
}

/** "host:port", "ssl://host:port" or "tcp://host:port" (default port 50002 with TLS). */
export function parseServer(value: string): ElectrumServer | null {
  const m = /^(?:(ssl|tls|tcp):\/\/)?([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(value.trim());
  if (!m) return null;
  const tls = (m[1] ?? 'ssl').toLowerCase() !== 'tcp';
  const port = m[3] ? Number(m[3]) : tls ? 50002 : 50001;
  if (port < 1 || port > 65535) return null;
  return { host: m[2].toLowerCase(), port, tls };
}

/** The user's own server, if set (tried first). */
export async function getCustomServer(): Promise<ElectrumServer | null> {
  const raw = await SecureStore.getItemAsync(SERVER_KEY);
  return raw ? parseServer(raw) : null;
}

export async function setCustomServer(value: string | null): Promise<void> {
  if (!value) return SecureStore.deleteItemAsync(SERVER_KEY);
  const s = parseServer(value);
  if (!s) throw new Error('Expected host:port, e.g. electrum.example.com:50002');
  await SecureStore.setItemAsync(SERVER_KEY, serverLabel(s));
}

async function loadPins(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(PINS_KEY)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

async function savePin(server: ElectrumServer, fingerprint: string) {
  const pins = await loadPins();
  pins[serverLabel(server)] = fingerprint;
  await SecureStore.setItemAsync(PINS_KEY, JSON.stringify(pins));
}

/** Forget a pinned certificate (when a server renewed its self-signed one). */
export async function forgetPin(server: ElectrumServer) {
  const pins = await loadPins();
  delete pins[serverLabel(server)];
  await SecureStore.setItemAsync(PINS_KEY, JSON.stringify(pins));
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let nextSocket = 1;

export class ElectrumClient {
  readonly server: ElectrumServer;
  private id: string;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<(params: unknown[]) => void>>();
  private closed = false;
  private sub: { remove: () => void } | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  onClose: ((reason: string) => void) | null = null;

  private constructor(server: ElectrumServer) {
    this.server = server;
    this.id = `electrum-${nextSocket++}`;
  }

  /** Opens a connection to one server and checks that it is Bitcoin mainnet. */
  static async connect(server: ElectrumServer): Promise<ElectrumClient> {
    if (!transport) throw new Error('Electrum needs the Raijin app (Android or desktop).');
    const client = new ElectrumClient(server);
    client.sub = transport.addListener('onSocket', (e) => e.id === client.id && client.handle(e.type, e.data, e.reason));
    const pins = await loadPins();
    const pinned = pins[serverLabel(server)];
    const viaTor = isTorForAll() || server.host.endsWith('.onion');
    try {
      // Pinned fingerprint, or first use: accept and pin what we see.
      const fingerprint = await transport.socketOpen(client.id, server.host, server.port, server.tls, viaTor, server.tls ? (pinned ?? '*') : null);
      await client.request('server.version', ['Raijin', '1.4']);
      const header = (await client.request('blockchain.block.header', [0])) as string;
      if (blockHash(header) !== GENESIS) throw new Error('not a Bitcoin mainnet server');
      if (server.tls && fingerprint && !pinned) await savePin(server, fingerprint);
    } catch (e) {
      client.close();
      throw e;
    }
    client.ping = setInterval(() => void client.request('server.ping', []).catch(() => client.close('ping failed')), 60_000);
    return client;
  }

  private handle(type: 'data' | 'close', data?: string, reason?: string) {
    if (type === 'close') return this.close(reason || 'closed');
    if (!data) return;
    let msg: { id?: number; result?: unknown; error?: { message?: string } | string; method?: string; params?: unknown[] };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(typeof msg.error === 'string' ? msg.error : (msg.error.message ?? 'electrum error')));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.listeners.get(msg.method)?.forEach((l) => l(msg.params ?? []));
    }
  }

  request(method: string, params: unknown[], timeoutMs = 30_000): Promise<unknown> {
    if (this.closed || !transport) return Promise.reject(new Error('electrum connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!transport!.socketSend(this.id, JSON.stringify({ jsonrpc: '2.0', id, method, params }))) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('electrum connection closed'));
      }
    });
  }

  /** Server notifications (blockchain.scripthash.subscribe, blockchain.headers.subscribe). */
  on(method: string, listener: (params: unknown[]) => void): () => void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  get isClosed() {
    return this.closed;
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.sub?.remove();
    transport?.socketClose(this.id);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`electrum: ${reason}`));
    }
    this.pending.clear();
    this.onClose?.(reason);
  }
}

/** Connects to the first server that works: custom, then the defaults. */
export async function connectAny(): Promise<ElectrumClient> {
  const custom = await getCustomServer();
  const list = custom ? [custom, ...servers.filter((s) => serverLabel(s) !== serverLabel(custom))] : servers;
  const errors: string[] = [];
  for (const server of list) {
    try {
      return await ElectrumClient.connect(server);
    } catch (e) {
      errors.push(`${server.host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`No Electrum server reachable (${errors.join('; ')})`);
}

/** Block hash (display order) of an 80-byte header in hex. */
export function blockHash(headerHex: string): string {
  return bytesToHex(sha256(sha256(hexToBytes(headerHex))).reverse());
}

/** Electrum's address key: sha256 of the output script, reversed, hex. */
export function scriptHash(script: Uint8Array): string {
  return bytesToHex(sha256(script).reverse());
}
