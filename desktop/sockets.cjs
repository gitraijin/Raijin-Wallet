'use strict';
/**
 * Line-based TCP/TLS sockets for Electrum servers, the counterpart of
 * NativeSockets.kt. Optional SOCKS (Tor, names resolved by Tor). A server
 * with a self-signed certificate is accepted by its SHA-256 fingerprint
 * (pin), or with pin "*" any certificate; the fingerprint seen is returned.
 */
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { SocksClient } = require('socks');

const sockets = new Map();

async function connectRaw(host, port, socksPort, timeoutMs) {
  if (socksPort) {
    const { socket } = await SocksClient.createConnection({
      proxy: { host: '127.0.0.1', port: socksPort, type: 5 },
      command: 'connect',
      destination: { host, port },
      timeout: timeoutMs,
    });
    return socket;
  }
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function open(id, host, port, useTls, socksPort, pin, emit) {
  const timeoutMs = socksPort ? 60_000 : 15_000;
  let socket = await connectRaw(host, port, socksPort, timeoutMs);
  let fingerprint = '';
  if (useTls) {
    socket = await new Promise((resolve, reject) => {
      const s = tls.connect({ socket, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false });
      s.once('secureConnect', () => {
        const cert = s.getPeerCertificate(false);
        fingerprint = cert && cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : '';
        const pinned = pin === '*' || (pin && pin.toLowerCase() === fingerprint);
        if (!pinned && !s.authorized) {
          s.destroy();
          reject(new Error(`TLS: certificate not trusted (fingerprint ${fingerprint || '?'})`));
          return;
        }
        resolve(s);
      });
      s.once('error', reject);
    });
  }
  sockets.set(id, socket);
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) emit({ id, type: 'data', data: line });
    }
  });
  socket.on('close', () => {
    if (sockets.delete(id)) emit({ id, type: 'close', reason: '' });
  });
  socket.on('error', (e) => {
    if (sockets.delete(id)) emit({ id, type: 'close', reason: e.message });
  });
  return fingerprint;
}

function send(id, line) {
  const s = sockets.get(id);
  if (!s) return false;
  s.write(String(line) + '\n');
  return true;
}

function close(id) {
  const s = sockets.get(id);
  sockets.delete(id);
  if (s) s.destroy();
}

function closeAll() {
  for (const s of sockets.values()) s.destroy();
  sockets.clear();
}

module.exports = { open, send, close, closeAll };
