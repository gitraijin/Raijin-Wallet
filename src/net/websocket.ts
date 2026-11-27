import { RaijinTor } from '../../modules/raijin-tor';
import { isOnionUrl, isTorForAll } from '../lightning/http';

/**
 * Tor-aware WebSocket, installed as globalThis.WebSocket (polyfills.ts).
 * NWC (nostr relays) opens plain WebSockets; with "route everything over
 * Tor" or a .onion relay those go through the native Tor client instead
 * (Android: OkHttp + SOCKS, desktop: ws + socks in the main process).
 * Everything else gets the original WebSocket unchanged.
 */
const Original = globalThis.WebSocket;
let nextId = 1;
const sockets = new Map<string, TorWebSocket>();

if (RaijinTor && 'addListener' in RaijinTor) {
  (RaijinTor as unknown as {
    addListener: (e: 'onWebSocket', l: (ev: { id: string; type: string; data?: string; code?: number; reason?: string }) => void) => unknown;
  }).addListener('onWebSocket', (event) => sockets.get(event.id)?.handle(event));
}

type Handler = ((event: { data?: string; code?: number; reason?: string; type: string }) => void) | null;

class TorWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  onopen: Handler = null;
  onmessage: Handler = null;
  onerror: Handler = null;
  onclose: Handler = null;
  private readonly id = `ws${nextId++}`;
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.set(this.id, this);
    const native = RaijinTor as unknown as { wsOpen: (id: string, url: string, tor: boolean, trustAll: boolean) => Promise<void> };
    native.wsOpen(this.id, this.url, true, isOnionUrl(this.url)).catch((error: unknown) => {
      this.handle({ type: 'error', reason: error instanceof Error ? error.message : String(error) });
      this.handle({ type: 'close', code: 1006, reason: 'tor' });
    });
  }

  handle(event: { type: string; data?: string; code?: number; reason?: string }): void {
    if (event.type === 'open') this.readyState = 1;
    if (event.type === 'close') {
      this.readyState = 3;
      sockets.delete(this.id);
    }
    const payload = { ...event, target: this, wasClean: event.code === 1000 };
    const handler = { open: this.onopen, message: this.onmessage, error: this.onerror, close: this.onclose }[event.type];
    handler?.call(this, payload);
    this.listeners.get(event.type)?.forEach((l) => l(payload));
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('WebSocket is not open');
    (RaijinTor as unknown as { wsSend: (id: string, text: string) => boolean }).wsSend(this.id, String(data));
  }

  close(code = 1000, reason?: string): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    (RaijinTor as unknown as { wsClose: (id: string, code: number, reason: string | null) => void }).wsClose(
      this.id,
      code,
      reason ?? null,
    );
  }

  addEventListener(type: string, listener: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function TorAwareWebSocket(this: unknown, url: string | URL, protocols?: string | string[]) {
  const target = String(url);
  if (RaijinTor && (isTorForAll() || isOnionUrl(target.replace(/^wss?:/, 'https:')))) {
    return new TorWebSocket(target);
  }
  return new Original(url, protocols);
}
// Static constants and instanceof checks keep working.
Object.assign(TorAwareWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
TorAwareWebSocket.prototype = Original.prototype;

export function installTorWebSocket(): void {
  if (!Original || (globalThis as { __raijinWs?: boolean }).__raijinWs) return;
  (globalThis as { __raijinWs?: boolean }).__raijinWs = true;
  globalThis.WebSocket = TorAwareWebSocket as unknown as typeof WebSocket;
}
