'use strict';
/**
 * HTTP client of the desktop app, the counterpart of NativeHttp.kt on Android.
 *
 * Runs in the Electron main process, so browser rules (CORS) do not apply,
 * and supports what Raijin needs for nodes:
 *  - SOCKS5 through Tor (hostnames resolved by Tor, so .onion works),
 *  - the node's own self-signed certificate from lndconnect (pinned),
 *    in addition to the system CAs,
 *  - "first line only" for LND's streaming endpoints (CloseChannel).
 *
 * The TLS handshake is finished and verified BEFORE any request byte is
 * written, so the macaroon never reaches a server that failed the check.
 */
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const { SocksClient } = require('socks');

const MAX_BODY = 20 * 1024 * 1024;

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('connection timed out'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function connectSocks(host, port, socksPort, timeoutMs) {
  const { socket } = await SocksClient.createConnection({
    proxy: { host: '127.0.0.1', port: socksPort, type: 5 },
    command: 'connect',
    destination: { host, port },
    timeout: timeoutMs,
  });
  return socket;
}

function upgradeTls(socket, host, request) {
  const pinned = request.certBase64 ? Buffer.from(request.certBase64, 'base64') : null;
  return new Promise((resolve, reject) => {
    const secure = tls.connect({
      socket,
      servername: net.isIP(host) ? undefined : host,
      // Verified by hand below: pinned node certificate OR system CAs + hostname.
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    secure.once('error', reject);
    secure.once('secureConnect', () => {
      const cert = secure.getPeerCertificate();
      const pinnedOk = pinned !== null && cert && cert.raw && pinned.equals(cert.raw);
      const systemOk = secure.authorized && tls.checkServerIdentity(host, cert) === undefined;
      if (request.trustAllCerts || pinnedOk || systemOk) {
        secure.removeListener('error', reject);
        resolve(secure);
        return;
      }
      secure.destroy();
      reject(
        new Error(
          pinned
            ? 'the server certificate does not match the one in the connection string'
            : `untrusted certificate (${secure.authorizationError || 'hostname mismatch'})`,
        ),
      );
    });
  });
}

/** One request over an already connected (and verified) socket. */
function exchange(socket, url, request, deadline) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const headers = { ...request.headers };
    if (request.body !== undefined && request.body !== null) {
      headers['Content-Length'] = Buffer.byteLength(request.body);
    }
    const req = http.request({
      createConnection: () => socket,
      host: url.hostname,
      port: url.port || undefined,
      method: request.method || 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
    });
    req.once('error', (error) => finish(() => reject(error)));
    req.once('response', (res) => {
      const status = res.statusCode || 0;
      const chunks = [];
      let size = 0;
      const okStatus = status >= 200 && status < 300;
      if (request.firstLineOnly && okStatus) {
        // A stream that stays silent (e.g. a close still waiting) is not an
        // error: answer with what arrived before the deadline.
        const wait = setTimeout(() => {
          finish(() => resolve({ status, body: '' }));
          res.destroy();
          socket.destroy();
        }, Math.max(0, deadline - Date.now() - 250));
        res.once('close', () => clearTimeout(wait));
      }
      res.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_BODY) {
          res.destroy();
          finish(() => reject(new Error('response too large')));
          return;
        }
        if (request.firstLineOnly && okStatus) {
          const text = Buffer.concat(chunks).toString('utf8');
          for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
              JSON.parse(line);
            } catch {
              return; // line not complete yet
            }
            finish(() => resolve({ status, body: line }));
            res.destroy();
            socket.destroy();
            return;
          }
        }
      });
      res.once('end', () => finish(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
      res.once('error', (error) => finish(() => reject(error)));
    });
    if (request.body !== undefined && request.body !== null) req.write(request.body);
    req.end();
  });
}

/**
 * @param request {url, method, headers, body?, timeoutMs, viaTor, certBase64?, trustAllCerts, firstLineOnly}
 * @param getSocksPort async () => port of a running Tor SOCKS proxy
 */
async function request(request, getSocksPort) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`unsupported protocol ${url.protocol}`);
  const secure = url.protocol === 'https:';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port) || (secure ? 443 : 80);
  const timeoutMs = Math.max(1000, Number(request.timeoutMs) || 20000);
  const deadline = Date.now() + timeoutMs;

  let socket;
  const timer = setTimeout(() => socket && socket.destroy(new Error('request timed out')), timeoutMs);
  try {
    socket = request.viaTor
      ? await connectSocks(host, port, await getSocksPort(), timeoutMs)
      : await connectTcp(host, port, timeoutMs);
    if (secure) socket = await upgradeTls(socket, host, request);
    return await exchange(socket, url, request, deadline);
  } finally {
    clearTimeout(timer);
    if (socket && !request.firstLineOnly) socket.end();
  }
}

module.exports = { request };
