import { NativeModule, requireOptionalNativeModule } from 'expo';

export type TorState = 'off' | 'starting' | 'on' | 'error';

export type TorStatus = {
  state: TorState;
  /** Bootstrap progress, 0-100. */
  progress: number;
  socksPort: number;
  error: string | null;
};

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

export type NativeWebSocketEvent = {
  id: string;
  type: 'open' | 'message' | 'close' | 'error';
  data?: string;
  code?: number;
  reason?: string;
};

type Events = {
  onStatus: (status: TorStatus) => void;
  onWebSocket: (event: NativeWebSocketEvent) => void;
};

declare class RaijinTorModule extends NativeModule<Events> {
  getStatus(): TorStatus;
  start(): Promise<number>;
  stop(): void;
  request(request: NativeHttpRequest): Promise<NativeHttpResponse>;
  wsOpen(id: string, url: string, viaTor: boolean, trustAll: boolean): Promise<void>;
  wsSend(id: string, text: string): boolean;
  wsClose(id: string, code: number, reason: string | null): void;
}

/** Null where the native module is missing (iOS, web, Expo Go). */
export const RaijinTor = requireOptionalNativeModule<RaijinTorModule>('RaijinTor');
