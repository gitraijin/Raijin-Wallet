'use strict';
/**
 * Exposes the small `raijinDesktop` API to the web app (see
 * src/lib/desktop.ts). Runs sandboxed: only IPC calls, no Node access.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** IPC results are {ok, value} | {ok: false, error} so error messages stay readable. */
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result || !result.ok) throw new Error(result ? result.error : 'IPC failed');
  return result.value;
}

const versionArg = process.argv.find((a) => a.startsWith('--raijin-version='));

contextBridge.exposeInMainWorld('raijinDesktop', {
  platform: process.platform,
  version: versionArg ? versionArg.split('=')[1] : '',
  request: (request) => call('http:request', request),
  secureGet: (key) => call('secure:get', key),
  secureSet: (key, value) => call('secure:set', key, value),
  secureDelete: (key) => call('secure:delete', key),
  torGetStatus: () => call('tor:status'),
  torStart: () => call('tor:start'),
  torStop: () => call('tor:stop'),
  onTorStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('tor:status', handler);
    return () => ipcRenderer.removeListener('tor:status', handler);
  },
  openExternal: (url) => call('shell:open', url),
  notify: (title, body) => call('notify', title, body),
  saveFile: (name, content) => call('file:save', name, content),
  takePendingLink: () => call('link:pending'),
  onOpenLink: (listener) => {
    const handler = (_event, url) => listener(url);
    ipcRenderer.on('open-link', handler);
    return () => ipcRenderer.removeListener('open-link', handler);
  },
  biometricsAvailable: () => call('bio:available'),
  promptBiometrics: (reason) => call('bio:prompt', reason),
  checkForUpdates: () => call('update:check'),
  setContentProtection: (on) => call('window:protect', on),
  wsOpen: (id, url, viaTor, trustAll) => call('ws:open', id, url, viaTor, trustAll),
  wsSend: (id, text) => call('ws:send', id, text),
  wsClose: (id, code, reason) => call('ws:close', id, code, reason),
  onWebSocket: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on('ws:event', handler);
    return () => ipcRenderer.removeListener('ws:event', handler);
  },
});
