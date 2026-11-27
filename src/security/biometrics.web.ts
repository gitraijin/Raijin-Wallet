import { desktop } from '@/lib/desktop';

/** Desktop: Touch ID on macOS through the Electron bridge; elsewhere none. */
export async function biometricsAvailable(): Promise<boolean> {
  return desktop ? desktop.biometricsAvailable().catch(() => false) : false;
}

export async function promptBiometrics(message: string, _cancelLabel: string): Promise<boolean> {
  return desktop ? desktop.promptBiometrics(message).catch(() => false) : false;
}
