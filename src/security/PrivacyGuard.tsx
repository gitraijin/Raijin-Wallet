import { useEffect } from 'react';

import { usePreferences } from '@/preferences/PreferencesContext';

import { setScreenProtection } from './privacy';

/** Applies the global screen protection setting. */
export function PrivacyGuard() {
  const { screenProtection, loaded } = usePreferences();
  useEffect(() => {
    if (!loaded) return;
    setScreenProtection('global', screenProtection).catch(() => {});
  }, [screenProtection, loaded]);
  return null;
}

/** Always protects the screen while mounted (recovery words), whatever the setting. */
export function useSensitiveScreen(): void {
  useEffect(() => {
    setScreenProtection('sensitive', true).catch(() => {});
    return () => {
      setScreenProtection('sensitive', false).catch(() => {});
    };
  }, []);
}
