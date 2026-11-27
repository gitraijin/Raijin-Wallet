import type { Href } from 'expo-router';

import { classifyLink } from './links';

/** Where a scanned QR code leads. Null if Raijin cannot use it. */
export function routeForScan(raw: string): Href | null {
  return classifyLink(raw);
}
