import * as LocalAuthentication from 'expo-local-authentication';

/** Fingerprint / face (Android, iOS). Desktop variant: biometrics.web.ts. */
export async function biometricsAvailable(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync().catch(() => false),
    LocalAuthentication.isEnrolledAsync().catch(() => false),
  ]);
  return hardware && enrolled;
}

export async function promptBiometrics(message: string, cancelLabel: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: message,
    cancelLabel,
    disableDeviceFallback: true, // our PIN is the fallback, not the device passcode
    biometricsSecurityLevel: 'strong',
  }).catch(() => ({ success: false as const }));
  return result.success;
}
