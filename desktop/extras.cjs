'use strict';
/**
 * Desktop integrations: payment links (lightning:, bitcoin:, cashu:, ...),
 * automatic updates and Touch ID.
 */
const { app, dialog, systemPreferences } = require('electron');

const LINK_SCHEMES = [
  'lightning',
  'bitcoin',
  'lnurl',
  'lnurlp',
  'lnurlw',
  'lnurlc',
  'keyauth',
  'cashu',
  'lndconnect',
  'nostr+walletconnect',
];
const LINK_RE = new RegExp(`^(${LINK_SCHEMES.map((s) => s.replace('+', '\\+')).join('|')}):`, 'i');

/* ------------------------------------------------------------------ */
/* Payment links                                                       */
/* ------------------------------------------------------------------ */

let pendingLink = null;
let deliver = null;

function findLink(argv) {
  return argv.find((arg) => LINK_RE.test(arg)) || null;
}

function receiveLink(url) {
  if (!url || !LINK_RE.test(url)) return;
  if (deliver) deliver(url);
  else pendingLink = url;
}

/**
 * Registers Raijin as handler for payment links. Must run before `ready`
 * (macOS sends open-url early). `onLink` is called once the window exists.
 */
function setupLinks(getWindow) {
  if (app.isPackaged) {
    for (const scheme of LINK_SCHEMES) app.setAsDefaultProtocolClient(scheme);
  }
  receiveLink(findLink(process.argv));
  // macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    receiveLink(url);
  });
  // Windows/Linux: a second start carries the link in argv.
  app.on('second-instance', (_event, argv) => receiveLink(findLink(argv)));

  deliver = (url) => {
    const win = getWindow();
    if (!win) {
      pendingLink = url;
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('open-link', url);
  };
}

/** The link the app was started with, handed out once. */
function takePendingLink() {
  const link = pendingLink;
  pendingLink = null;
  return link;
}

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

/**
 * electron-updater against the GitHub releases of the repository
 * (electron-builder.yml → publish). Windows (NSIS) and Linux (AppImage) only:
 * macOS updates require a Developer ID signature.
 */
function setupUpdates(getWindow) {
  if (!app.isPackaged || process.platform === 'darwin') return null;
  if (process.env.APPIMAGE === undefined && process.platform === 'linux') return null; // deb/tar.gz: package manager
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => console.warn('[update]', error && error.message));
  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Raijin update',
      message: `Raijin ${info.version} is ready.`,
      detail: 'Restart to install it now, or it is installed when you quit.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  setInterval(check, 6 * 60 * 60_000);
  return check;
}

/* ------------------------------------------------------------------ */
/* Biometrics                                                          */
/* ------------------------------------------------------------------ */

/** Touch ID on macOS; Windows Hello and Linux have no Electron API. */
function biometricsAvailable() {
  return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
}

async function promptBiometrics(reason) {
  if (!biometricsAvailable()) return false;
  try {
    await systemPreferences.promptTouchID(String(reason).slice(0, 200));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  LINK_SCHEMES,
  setupLinks,
  takePendingLink,
  setupUpdates,
  biometricsAvailable,
  promptBiometrics,
};
