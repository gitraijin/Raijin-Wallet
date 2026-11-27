import { RaijinTor } from '../../modules/raijin-tor';
import { desktop } from '../lib/desktop';

const DEFAULT_TIMEOUT_MS = 20_000;
/** Circuits add latency; give Tor requests more time. */
const TOR_TIMEOUT_FACTOR = 3;
/**
 * The desktop app sends every request through the Electron main process:
 * browsers enforce CORS, which LND REST and most nodes do not allow.
 */
const ALWAYS_NATIVE = desktop !== null;

/** "https://host:8080/path" -> "host:8080" (avoids relying on RN's partial URL implementation). */
function hostOf(url: string): string {
  return url.replace(/^\w+:\/\//, '').split(/[/?#]/)[0];
}

function hostnameOf(url: string): string {
  return hostOf(url).replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function isOnionUrl(url: string): boolean {
  return hostnameOf(url).endsWith('.onion');
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

let torForAll = false;

/** "Route everything over Tor" preference. Onion hosts always use Tor. */
export function setTorForAll(on: boolean): void {
  torForAll = on;
}

export function isTorForAll(): boolean {
  return torForAll;
}

/** Per-connection network settings. */
export type NetOptions = {
  /** The node's own TLS certificate (DER, standard base64), e.g. from lndconnect. */
  certBase64?: string;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  net?: NetOptions;
};

type RawOptions = Omit<RequestOptions, 'body'> & {
  /** Already serialized. */
  body?: string;
  /** Stop after the first non-empty line of a streaming response. */
  firstLineOnly?: boolean;
};

export type RawResponse = { status: number; ok: boolean; text: string };

/**
 * The single place where the app talks HTTP. Uses the native client when the
 * request must go over Tor or trust a node's own certificate (and always in
 * the desktop app), fetch otherwise.
 */
export async function rawRequest(url: string, options: RawOptions = {}): Promise<RawResponse> {
  const viaTor = torForAll || isOnionUrl(url);
  const certBase64 = options.net?.certBase64;
  const needsNative = viaTor || certBase64 !== undefined || ALWAYS_NATIVE;
  const timeoutMs = (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) * (viaTor ? TOR_TIMEOUT_FACTOR : 1);
  const headers = { Accept: 'application/json', ...options.headers };

  if (needsNative) {
    if (!RaijinTor) {
      throw new Error(
        viaTor
          ? 'Tor is not available on this device.'
          : 'Self-signed node certificates need the Android or desktop app.',
      );
    }
    try {
      const response = await RaijinTor.request({
        url,
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        timeoutMs,
        viaTor,
        certBase64,
        // An onion address authenticates the server; its TLS cert is self-signed anyway.
        trustAllCerts: isOnionUrl(url),
        firstLineOnly: options.firstLineOnly ?? false,
      });
      return { status: response.status, ok: response.status >= 200 && response.status < 300, text: response.body };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot reach ${hostOf(url)}${viaTor ? ' over Tor' : ''}: ${reason}`);
    }
  }

  if (options.firstLineOnly) return firstLineViaXhr(url, headers, options.method ?? 'GET', timeoutMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
    });
    return { status: response.status, ok: response.ok, text: await response.text() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request timed out: ${hostOf(url)}`);
    throw new Error(`Cannot reach ${hostOf(url)}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * React Native's fetch cannot read a body incrementally; XHR progress events
 * can. Resolves with the first non-empty line, or an empty text on timeout.
 */
function firstLineViaXhr(
  url: string,
  headers: Record<string, string>,
  method: string,
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      xhr.abort();
    };
    const ok = () => xhr.status >= 200 && xhr.status < 300;
    const tryLine = () => {
      if (!ok()) return false; // error bodies are handled in onload
      const text = xhr.responseText ?? '';
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          JSON.parse(line); // a complete line
        } catch {
          return false;
        }
        finish(() => resolve({ status: xhr.status, ok: true, text: line }));
        return true;
      }
      return false;
    };
    const timer = setTimeout(() => finish(() => resolve({ status: 0, ok: true, text: '' })), timeoutMs);

    xhr.open(method, url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.responseType = 'text';
    xhr.onprogress = () => void tryLine();
    xhr.onload = () => {
      if (tryLine()) return;
      finish(() => resolve({ status: xhr.status, ok: ok(), text: xhr.responseText ?? '' }));
    };
    xhr.onerror = () => finish(() => reject(new Error(`Cannot reach ${hostOf(url)}`)));
    xhr.send();
  });
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

function errorFrom(status: number, text: string): HttpError {
  let message: string | undefined;
  try {
    const data = JSON.parse(text) as { message?: string; error?: unknown };
    message = data.message ?? (typeof data.error === 'string' ? data.error : undefined);
  } catch {}
  return new HttpError(status, message ?? `HTTP ${status}`);
}

/** JSON request with a timeout and readable errors. */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(url, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw errorFrom(response.status, response.text);
  try {
    return (response.text ? JSON.parse(response.text) : {}) as T;
  } catch {
    throw new Error(`Unexpected response (HTTP ${response.status})`);
  }
}

/**
 * First update of a newline-delimited JSON stream (e.g. LND's CloseChannel,
 * which only ends once the channel is fully closed). Null if none arrived.
 */
export async function requestFirstStreamUpdate<T>(url: string, options: RequestOptions = {}): Promise<T | null> {
  const response = await rawRequest(url, { ...options, body: undefined, firstLineOnly: true });
  if (!response.ok) throw errorFrom(response.status, response.text);
  if (!response.text.trim()) return null;
  try {
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parses LND/LNDHub numbers, which arrive as numbers or (int64) strings. */
export function toSats(value: string | number | undefined | null): bigint {
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(value.split('.')[0]);
}
