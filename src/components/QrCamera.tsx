import { StyleSheet } from 'react-native';

import { RaijinScanView } from '../../modules/raijin-scan';

export type QrCameraProps = { torch: boolean; onScanned: (result: { data: string }) => void };

/**
 * Android: our own camera view (CameraX + ZXing). expo-camera's scanner would
 * bring Google ML Kit, Google Play services and Google telemetry along.
 */
export function QrCamera({ torch, onScanned }: QrCameraProps) {
  return (
    <RaijinScanView
      style={StyleSheet.absoluteFill}
      torch={torch}
      onScan={(event) => onScanned({ data: event.nativeEvent.data })}
    />
  );
}
