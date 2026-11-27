/**
 * Bridge to the Electron main process (desktop/preload.cjs). Null on Android,
 * iOS and in a plain browser.
 */
export type DesktopHttpRequest = {
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

export type DesktopTorStatus = {
  state: 'off' | 'starting' | 'on' | 'error';
  progress: number;
  socksPort: number;
  error: string | null;
};

export type DesktopBridge = {
  platform: 'win32' | 'darwin' | 'linux';
  version: string;
  request(request: DesktopHttpRequest): Promise<{ status: number; body: string }>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureDelete(key: string): Promise<void>;
  torGetStatus(): Promise<DesktopTorStatus>;
  torStart(): Promise<number>;
  torStop(): Promise<void>;
  onTorStatus(listener: (status: DesktopTorStatus) => void): () => void;
  openExternal(url: string): Promise<void>;
  /** Native system notification. */
  notify(title: string, body: string): Promise<void>;
  /** "Save as" dialog; resolves false if cancelled. */
  saveFile(name: string, content: string): Promise<boolean>;
  /** Payment link the app was started with (lightning:, bitcoin:, ...), once. */
  takePendingLink(): Promise<string | null>;
  onOpenLink(listener: (url: string) => void): () => void;
  /** Touch ID (macOS). */
  biometricsAvailable(): Promise<boolean>;
  promptBiometrics(reason: string): Promise<boolean>;
  /** Null where updates are not supported (macOS, deb/tar.gz, development). */
  checkForUpdates(): Promise<unknown>;
  /** Keep the window out of screenshots / screen sharing (Windows, macOS). */
  setContentProtection(on: boolean): Promise<void>;
  /** WebSockets over Tor (NWC relays). */
  wsOpen(id: string, url: string, viaTor: boolean, trustAll: boolean): Promise<void>;
  wsSend(id: string, text: string): Promise<boolean>;
  wsClose(id: string, code: number, reason: string | null): Promise<void>;
  onWebSocket(
    listener: (event: { id: string; type: 'open' | 'message' | 'close' | 'error'; data?: string; code?: number; reason?: string }) => void,
  ): () => void;
};

export const desktop: DesktopBridge | null =
  (globalThis as { raijinDesktop?: DesktopBridge }).raijinDesktop ?? null;
