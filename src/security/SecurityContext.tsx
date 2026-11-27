import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { useT } from '@/preferences/PreferencesContext';

import { biometricsAvailable as deviceBiometrics, promptBiometrics as devicePrompt } from './biometrics';
import { setDecoyNamespace } from '@/lib/storage-namespace';

import { clearSecurity, hasPin, isBiometricsEnabled, setBiometricsEnabled, setPin } from './pin';

/** Lock again after the app has been in the background this long. */
const RELOCK_AFTER_MS = 60_000;

/** What the PIN overlay is currently asking for. */
export type AuthRequest = { id: number } & (
  | { mode: 'unlock' } // app lock, cannot be dismissed
  | { mode: 'confirm'; reason: string } // sensitive action, can be cancelled
);

let nextRequestId = 1;

type SecurityContextValue = {
  loaded: boolean;
  pinSet: boolean;
  biometricsEnabled: boolean;
  /** Device has biometric hardware with something enrolled. */
  biometricsAvailable: boolean;
  /** Non-null while the PIN overlay should be shown. */
  request: AuthRequest | null;

  savePin: (pin: string) => Promise<void>;
  setBiometrics: (enabled: boolean) => Promise<boolean>;
  /** Prompts the system biometric dialog. */
  promptBiometrics: (message: string) => Promise<boolean>;
  /** Asks for biometrics/PIN before a sensitive action. Resolves false if cancelled. */
  authenticate: (reason: string) => Promise<boolean>;
  /** Called by the overlay once the PIN or biometrics succeeded / was cancelled. */
  resolveRequest: (ok: boolean) => void;
  /**
   * True after unlocking with the duress PIN: the app then shows the decoy
   * wallet (separate storage namespace). Unlocking with the real PIN or
   * biometrics switches back.
   */
  decoy: boolean;
  /** Overlay: an unlock succeeded with the real (false) or duress (true) PIN. */
  unlockedWith: (duress: boolean) => void;
  reset: () => Promise<void>;
};

const SecurityContext = createContext<SecurityContextValue | null>(null);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [request, setRequest] = useState<AuthRequest | null>(null);
  const [decoy, setDecoy] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const t = useT();

  useEffect(() => {
    (async () => {
      const [pin, bio, available] = await Promise.all([hasPin(), isBiometricsEnabled(), deviceBiometrics()]);
      setPinSet(pin);
      setBiometricsEnabledState(bio && available);
      setBiometricsAvailable(available);
      if (pin) setRequest({ id: nextRequestId++, mode: 'unlock' });
      setLoaded(true);
    })();
  }, []);

  // Re-lock after some time in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (pinSet && away >= RELOCK_AFTER_MS) {
          resolverRef.current?.(false); // a pending confirm is void once locked
          resolverRef.current = null;
          setRequest({ id: nextRequestId++, mode: 'unlock' });
        }
      }
    });
    return () => sub.remove();
  }, [pinSet]);

  const savePin = useCallback(async (pin: string) => {
    await setPin(pin);
    setPinSet(true);
  }, []);

  const promptBiometrics = useCallback(async (message: string) => {
    return devicePrompt(message, t('auth.usePin'));
  }, [t]);

  const setBiometrics = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // Confirm once that it actually works before relying on it.
        const ok = await promptBiometrics(t('auth.enableBio'));
        if (!ok) return false;
      }
      await setBiometricsEnabled(enabled);
      setBiometricsEnabledState(enabled);
      return true;
    },
    [promptBiometrics, t],
  );

  const authenticate = useCallback(
    (reason: string) => {
      if (!pinSet) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setRequest({ id: nextRequestId++, mode: 'confirm', reason });
      });
    },
    [pinSet],
  );

  const resolveRequest = useCallback((ok: boolean) => {
    setRequest((current) => {
      if (current?.mode === 'unlock' && !ok) return current; // the app lock cannot be dismissed
      return null;
    });
    resolverRef.current?.(ok);
    resolverRef.current = null;
  }, []);

  const unlockedWith = useCallback((duress: boolean) => {
    // Switch storage before React re-renders the wallet providers (keyed on decoy).
    setDecoyNamespace(duress);
    setDecoy(duress);
  }, []);

  const reset = useCallback(async () => {
    // The decoy wallet never removes the real PIN.
    if (decoy) return;
    await clearSecurity();
    setPinSet(false);
    setBiometricsEnabledState(false);
    setRequest(null);
  }, [decoy]);

  const value = useMemo<SecurityContextValue>(
    () => ({
      loaded,
      pinSet,
      biometricsEnabled,
      biometricsAvailable,
      request,
      savePin,
      setBiometrics,
      promptBiometrics,
      authenticate,
      resolveRequest,
      reset,
      decoy,
      unlockedWith,
    }),
    [
      loaded,
      pinSet,
      biometricsEnabled,
      biometricsAvailable,
      request,
      savePin,
      setBiometrics,
      promptBiometrics,
      authenticate,
      resolveRequest,
      reset,
      decoy,
      unlockedWith,
    ],
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityContextValue {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used inside <SecurityProvider>');
  return ctx;
}
