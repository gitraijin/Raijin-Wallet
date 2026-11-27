import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NotifyPermission = { granted: boolean; canAskAgain: boolean; status: string };

declare class RaijinNotifyNative extends NativeModule {
  setChannel(id: string, name: string, color: string, vibration: number[]): void;
  getPermission(): Promise<NotifyPermission>;
  requestPermission(): Promise<NotifyPermission>;
  show(channelId: string, title: string, body: string): void;
}

/** Local notifications without Google services (Android only; null elsewhere). */
export const RaijinNotify = requireOptionalNativeModule<RaijinNotifyNative>('RaijinNotify');
