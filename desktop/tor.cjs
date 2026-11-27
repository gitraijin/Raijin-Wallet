'use strict';
/**
 * Tor for the desktop app, the counterpart of the Android TorService.
 *
 * Starts the Tor binary shipped with the app (Tor Expert Bundle, fetched by
 * scripts/fetch-tor.mjs into tor-bundle/ and packaged as an extra resource).
 * Without a bundled binary it falls back to a Tor that already runs on this
 * computer (system tor on 9050, Tor Browser on 9150).
 */
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const BOOTSTRAP_TIMEOUT_MS = 3 * 60_000;
const SYSTEM_PORTS = [9050, 9150];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** True if a SOCKS5 server answers the greeting on this port. */
function isSocks(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once('error', () => done(false));
    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
    socket.once('data', (data) => done(data.length >= 2 && data[0] === 0x05 && data[1] === 0x00));
  });
}

class TorManager extends EventEmitter {
  /**
   * @param bundleDir folder with tor/ (binary + libraries) and data/ (geoip)
   * @param dataDir   writable folder for Tor's state
   */
  constructor(bundleDir, dataDir) {
    super();
    this.bundleDir = bundleDir;
    this.dataDir = dataDir;
    this.status = { state: 'off', progress: 0, socksPort: 0, error: null };
    this.process = null;
    this.starting = null;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  binary() {
    const name = process.platform === 'win32' ? 'tor.exe' : 'tor';
    const file = path.join(this.bundleDir, 'tor', name);
    return fs.existsSync(file) ? file : null;
  }

  /** Resolves with the SOCKS port once Tor is usable. */
  start() {
    if (this.status.state === 'on') return Promise.resolve(this.status.socksPort);
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async launch() {
    this.setStatus({ state: 'starting', progress: 0, error: null });
    const binary = this.binary();
    if (!binary) {
      for (const port of SYSTEM_PORTS) {
        if (await isSocks(port)) {
          this.setStatus({ state: 'on', progress: 100, socksPort: port });
          return port;
        }
      }
      const error = 'Tor is not bundled with this build and no Tor runs on port 9050/9150.';
      this.setStatus({ state: 'error', error });
      throw new Error(error);
    }

    const port = await freePort();
    fs.mkdirSync(this.dataDir, { recursive: true });
    const torDir = path.dirname(binary);
    const args = [
      '--SocksPort', `127.0.0.1:${port}`,
      '--DataDirectory', this.dataDir,
      '--ClientOnly', '1',
      '--AvoidDiskWrites', '1',
      '--Log', 'notice stdout',
    ];
    const geoip = path.join(this.bundleDir, 'data', 'geoip');
    const geoip6 = path.join(this.bundleDir, 'data', 'geoip6');
    if (fs.existsSync(geoip)) args.push('--GeoIPFile', geoip);
    if (fs.existsSync(geoip6)) args.push('--GeoIPv6File', geoip6);

    const env = { ...process.env };
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [torDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = [torDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: torDir, env, windowsHide: true });
      this.process = child;
      let ready = false;
      const fail = (message) => {
        clearTimeout(timer);
        if (this.process === child) this.process = null;
        child.kill();
        this.setStatus({ state: 'error', socksPort: 0, error: message });
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('Tor did not finish bootstrapping in time.'), BOOTSTRAP_TIMEOUT_MS);

      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const match = /Bootstrapped (\d+)%/.exec(line);
          if (!match || ready) continue;
          const progress = Number(match[1]);
          if (progress >= 100) {
            ready = true;
            clearTimeout(timer);
            this.setStatus({ state: 'on', progress: 100, socksPort: port, error: null });
            resolve(port);
          } else {
            this.setStatus({ progress });
          }
        }
      });
      child.once('error', (error) => fail(`Cannot start Tor: ${error.message}`));
      child.once('exit', (code) => {
        if (this.process === child) this.process = null;
        if (!ready) {
          fail(`Tor exited (code ${code}).`);
        } else if (this.status.state !== 'off') {
          this.setStatus({ state: 'error', socksPort: 0, error: `Tor exited (code ${code}).` });
        }
      });
    });
  }

  stop() {
    const child = this.process;
    this.process = null;
    if (child) child.kill();
    this.setStatus({ state: 'off', progress: 0, socksPort: 0, error: null });
  }
}

module.exports = { TorManager };
