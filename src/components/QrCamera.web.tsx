import { CameraView } from 'expo-camera';
import { StyleSheet } from 'react-native';

import type { QrCameraProps } from './QrCamera';

/** Desktop webcam / browser: expo-camera's web scanner (no Google code involved). */
export function QrCamera({ torch, onScanned }: QrCameraProps) {
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={torch}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={onScanned}
    />
  );
}
