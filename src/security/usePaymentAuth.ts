import { useCallback } from 'react';

import { usePreferences } from '@/preferences/PreferencesContext';

import { useSecurity } from './SecurityContext';

/**
 * Asks for PIN/biometrics before a payment above the user's limit
 * (Settings → security). Resolves false if the user cancels.
 */
export function usePaymentAuth(): (amountSats: bigint, reason: string) => Promise<boolean> {
  const { pinLimit } = usePreferences();
  const { authenticate, pinSet } = useSecurity();
  return useCallback(
    async (amountSats, reason) => {
      if (!pinSet || pinLimit === 'never') return true;
      if (pinLimit !== 'always' && amountSats <= BigInt(pinLimit)) return true;
      return authenticate(reason);
    },
    [pinLimit, pinSet, authenticate],
  );
}
