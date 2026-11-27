import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

export type QrScanEvent = { nativeEvent: { data: string } };

export type RaijinScanViewProps = ViewProps & {
  torch?: boolean;
  onScan?: (event: QrScanEvent) => void;
};

/** Android camera preview that reports QR codes (CameraX + ZXing, no Google services). */
export const RaijinScanView = requireNativeView<RaijinScanViewProps>('RaijinScan');
