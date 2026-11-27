import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

/**
 * Screen protection (Android FLAG_SECURE: no screenshots, no recording, blank
 * preview in the app switcher; iOS: screenshot block + blurred switcher).
 * Keys let several screens request protection independently.
 */
export async function setScreenProtection(key: string, on: boolean): Promise<void> {
  if (on) {
    await ScreenCapture.preventScreenCaptureAsync(key);
    if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
  } else {
    await ScreenCapture.allowScreenCaptureAsync(key);
    if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync();
  }
}
