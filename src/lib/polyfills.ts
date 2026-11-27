/**
 * Must be imported before anything else (see app/_layout.tsx).
 *
 * nostr-tools / @noble (used by NWC) need `crypto.getRandomValues`. We back it
 * with the platform CSPRNG from expo-crypto where the runtime lacks it.
 */
import { getRandomValues } from 'expo-crypto';

const g = globalThis as { crypto?: Partial<Crypto> };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...g.crypto, getRandomValues: getRandomValues as Crypto['getRandomValues'] };
}

