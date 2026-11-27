'use strict';
/**
 * Raijin desktop (Windows, macOS, Linux).
 *
 * The UI is the same Expo app as on Android, exported for the web
 * (`expo export --platform web` -> desktop/web) and served from the custom
 * app:// protocol. Everything a browser cannot do safely runs here in the
 * main process and is reached over IPC (preload.cjs):
 *   net.cjs     HTTP without CORS, Tor SOCKS, pinned node certificates
 *   tor.cjs     bundled Tor (or a Tor already running on the computer)
 *   secure.cjs  secrets encrypted with the OS keychain
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, shell } = require('electron');

const { biometricsAvailable, promptBiometrics, setupLinks, setupUpdates, takePendingLink } = require('./extras.cjs');
const { request } = require('./net.cjs');
const { SecureStore } = require('./secure.cjs');
const { TorManager } = require('./tor.cjs');
const websockets = require('./websockets.cjs');

const WEB_DIR = path.join(__dirname, 'web');
const ORIGIN = 'app://raijin';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// HTTP goes through IPC, so the page itself only needs its own files plus
// WebSockets for NWC relays.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' wss: ws:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Development runs keep their own data, so test mints and nodes never show
// up in an installed Raijin.
// Installed builds keep the data folder "Raijin" from before the rename to
// "Raijin Wallet", so existing wallets and settings are still found.
app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged ? 'Raijin' : 'Raijin-dev'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Payment links (lightning:, bitcoin:, cashu:, ...); registered before `ready` for macOS.
setupLinks(() => mainWindow);

let mainWindow = null;
let secure = null;
let tor = null;
let checkUpdates = null;

/* ------------------------------------------------------------------ */
/* app:// protocol: the exported web app, SPA fallback to index.html   */
/* ------------------------------------------------------------------ */

function serveApp(req) {
  const { pathname } = new URL(req.url);
  let file = path.normalize(path.join(WEB_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB_DIR)) return new Response('Forbidden', { status: 403 });
  let exists = false;
  try {
    exists = fs.statSync(file).isFile();
  } catch {}
  // Routes like /cashu have no file: the router in index.html handles them.
  if (!exists) file = path.join(WEB_DIR, 'index.html');
  const body = fs.readFileSync(file);
  return new Response(body, {
    headers: {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

/** Only the app's own page may use the bridge. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame ? event.senderFrame.url : '';
    if (!url.startsWith(`${ORIGIN}/`)) return { ok: false, error: 'Forbidden' };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  });
}

function registerIpc() {
  handle('http:request', (req) => request(req, () => tor.start()));
  handle('secure:get', (key) => secure.get(String(key)));
  handle('secure:set', (key, value) => secure.set(String(key), String(value)));
  handle('secure:delete', (key) => secure.delete(String(key)));
  handle('tor:status', () => tor.status);
  handle('tor:start', () => tor.start());
  handle('tor:stop', () => tor.stop());
  handle('shell:open', (url) => openExternal(url));
  handle('link:pending', () => takePendingLink());
  handle('ws:open', async (id, url, viaTor, trustAll) => {
    const port = viaTor ? await tor.start() : 0;
    websockets.open(String(id), String(url), port, Boolean(trustAll), (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ws:event', event);
    });
  });
  handle('ws:send', (id, text) => websockets.send(String(id), text));
  handle('ws:close', (id, code, reason) => websockets.close(String(id), code, reason));
  handle('bio:available', () => biometricsAvailable());
  handle('bio:prompt', (reason) => promptBiometrics(reason));
  handle('window:protect', (on) => {
    mainWindow?.setContentProtection(Boolean(on));
  });
  handle('update:check', () => (checkUpdates ? checkUpdates() : null));
  handle('file:save', async (name, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), path.basename(String(name))),
    });
    if (canceled || !filePath) return false;
    await fs.promises.writeFile(filePath, String(content), 'utf8');
    return true;
  });
  handle('notify', (title, body) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: String(title), body: String(body), silent: false });
    notification.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  });
}

function openExternal(url) {
  // Only web links leave the app; never file:, javascript: and the like.
  if (/^https:\/\//i.test(url)) return shell.openExternal(url);
  throw new Error('Only https links can be opened.');
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 880,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#07080B',
    title: 'Raijin',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      additionalArguments: [`--raijin-version=${app.getVersion()}`],
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links open in the system browser; the window itself never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      Promise.resolve(openExternal(url)).catch(() => {});
    } catch {
      // not an https link: ignored
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    // Clipboard (paste) and the webcam for the QR scanner; never the microphone.
    const videoOnly =
      permission === 'media' && (details.mediaTypes ?? []).length > 0 && details.mediaTypes.every((t) => t === 'video');
    callback(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read' || videoOnly);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
  }
  // Development smoke test: RAIJIN_SMOKE=<file.png> saves a screenshot and quits.
  if (!app.isPackaged && process.env.RAIJIN_SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.RAIJIN_SMOKE_JS) {
          const result = await mainWindow.webContents.executeJavaScript(process.env.RAIJIN_SMOKE_JS).catch((e) => `error: ${e}`);
          console.log('[smoke]', JSON.stringify(result));
        }
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(process.env.RAIJIN_SMOKE, image.toPNG());
        app.quit();
      }, Number(process.env.RAIJIN_SMOKE_DELAY || 5000));
    });
  }

  mainWindow.loadURL(`${ORIGIN}${(!app.isPackaged && process.env.RAIJIN_SMOKE_PATH) || '/'}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // Windows shows notifications only for apps with an AppUserModelID.
  if (process.platform === 'win32') app.setAppUserModelId('com.raijin.wallet');
  const bundleDir = app.isPackaged
    ? path.join(process.resourcesPath, 'tor-bundle')
    : path.join(__dirname, 'tor-bundle', `${{ win32: 'win', darwin: 'mac' }[process.platform] || process.platform}-${process.arch}`);
  secure = new SecureStore(path.join(app.getPath('userData'), 'secure-store.json'));
  tor = new TorManager(bundleDir, path.join(app.getPath('userData'), 'tor'));
  tor.on('status', (status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('tor:status', status);
  });

  protocol.handle('app', serveApp);
  registerIpc();
  buildMenu();
  createWindow();
  checkUpdates = setupUpdates(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  websockets.closeAll();
  if (tor) tor.stop();
});
