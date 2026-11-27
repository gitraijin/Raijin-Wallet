import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { errorMessage } from '@/lib/format';
import type { Channel } from '@/lightning';

import { useWallet } from './WalletContext';

const POLL_MS = 20_000;

/** Channel list of the active node; reloads on focus and every few seconds while focused. */
export function useChannels() {
  const { backend } = useWallet();
  const features = backend?.channels;
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (!features || inFlight.current) return;
    inFlight.current = true;
    try {
      setChannels(await features.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
    }
  }, [features]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      const timer = setInterval(() => void reload(), POLL_MS);
      return () => clearInterval(timer);
    }, [reload]),
  );

  return { supported: features !== undefined, channels, error, reload };
}
