'use strict';
/**
 * WebSockets over Tor for NWC relays, the counterpart of NativeWebSockets.kt.
 * The renderer's WebSocket cannot use SOCKS; these run in the main process
 * and forward events to the window ("ws:event").
 */
const WebSocket = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');

const sockets = new Map();

function open(id, url, socksPort, trustAll, emit) {
  // socks5h: the host name is resolved by Tor (.onion works).
  const agent = socksPort ? new SocksProxyAgent(`socks5h://127.0.0.1:${socksPort}`) : undefined;
  const ws = new WebSocket(url, { agent, rejectUnauthorized: !trustAll, handshakeTimeout: 60_000 });
  sockets.set(id, ws);
  ws.on('open', () => emit({ id, type: 'open' }));
  ws.on('message', (data) => emit({ id, type: 'message', data: data.toString('utf8') }));
  ws.on('error', (error) => emit({ id, type: 'error', reason: error.message }));
  ws.on('close', (code, reason) => {
    sockets.delete(id);
    emit({ id, type: 'close', code, reason: reason.toString('utf8') });
  });
  // Keep NAT/Tor circuits alive.
  const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 30_000);
  ws.on('close', () => clearInterval(ping));
}

function send(id, text) {
  const ws = sockets.get(id);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(String(text));
  return true;
}

function close(id, code, reason) {
  const ws = sockets.get(id);
  sockets.delete(id);
  if (ws) ws.close(code || 1000, reason || undefined);
}

function closeAll() {
  for (const ws of sockets.values()) ws.terminate();
  sockets.clear();
}

module.exports = { open, send, close, closeAll };
