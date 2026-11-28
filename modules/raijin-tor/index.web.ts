/**
 * Web / desktop variant of the RaijinTor module. In the desktop app the same
 * interface is backed by the Electron main process (desktop/tor.cjs and
 * desktop/net.cjs): a bundled Tor binary and a Node HTTP client with SOCKS and
 * certificate pinning. In a plain browser the module is missing (null), like
 * on iOS.
 */
import { desktop, type DesktopTorStatus } from '../../src/lib/desktop';

export type TorState = 'off' | 'starting' | 'on' | 'error';
export type TorStatus = DesktopTorStatus;

export type NativeHttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  viaTor: boolean;
  certBase64?: string;
  trustAllCerts: boolean;
  firstLineOnly: boolean;
};

export type NativeHttpResponse = { status: number; body: string };

/** Electrum sockets: one line of JSON per "data" event. */
export type NativeSocketEvent = { id: string; type: 'data' | 'close'; data?: string; reason?: string };

export type NativeWebSocketEvent = {
  id: string;
  type: 'open' | 'message' | 'close' | 'error';
  data?: string;
  code?: number;
  reason?: string;
};

type Listener = (status: TorStatus) => void;
type WsListener = (event: NativeWebSocketEvent) => void;
type SocketListener = (event: NativeSocketEvent) => void;

function createDesktopTor() {
  if (!desktop) return null;
  const bridge = desktop;
  let status: TorStatus = { state: 'off', progress: 0, socksPort: 0, error: null };
  const listeners = new Set<Listener>();
  const wsListeners = new Set<WsListener>();
  const socketListeners = new Set<SocketListener>();
  bridge.onWebSocket((event) => wsListeners.forEach((l) => l(event)));
  bridge.onSocket((event) => socketListeners.forEach((l) => l(event)));
  const emit = (next: TorStatus) => {
    status = next;
    listeners.forEach((l) => l(next));
  };
  bridge.onTorStatus(emit);
  bridge.torGetStatus().then(emit, () => {});

  return {
    getStatus: (): TorStatus => status,
    start: () => bridge.torStart(),
    stop: () => void bridge.torStop(),
    request: (request: NativeHttpRequest): Promise<NativeHttpResponse> => bridge.request(request),
    wsOpen: (id: string, url: string, viaTor: boolean, trustAll: boolean) => bridge.wsOpen(id, url, viaTor, trustAll),
    // Fire and forget, like the synchronous native function.
    wsSend: (id: string, text: string) => {
      void bridge.wsSend(id, text);
      return true;
    },
    wsClose: (id: string, code: number, reason: string | null) => void bridge.wsClose(id, code, reason),
    socketOpen: (id: string, host: string, port: number, tls: boolean, viaTor: boolean, pin: string | null) => bridge.socketOpen(id, host, port, tls, viaTor, pin),
    socketSend: (id: string, line: string) => {
      void bridge.socketSend(id, line);
      return true;
    },
    socketClose: (id: string) => void bridge.socketClose(id),
    addListener: ((event: 'onStatus' | 'onWebSocket' | 'onSocket', listener: Listener | WsListener | SocketListener) => {
      const set = (event === 'onStatus' ? listeners : event === 'onSocket' ? socketListeners : wsListeners) as Set<Listener | WsListener | SocketListener>;
      set.add(listener);
      return { remove: () => set.delete(listener) };
    }) as {
      (event: 'onStatus', listener: Listener): { remove: () => void };
      (event: 'onWebSocket', listener: WsListener): { remove: () => void };
      (event: 'onSocket', listener: SocketListener): { remove: () => void };
    },
  };
}

export const RaijinTor = createDesktopTor();
