import { linkToPath } from '@/lib/links';

/**
 * System links into the app (Android intent filters in app.json):
 * lightning:, bitcoin:, lnurl…:, cashu:, lndconnect:, nostr+walletconnect:.
 * They are not app paths, so they are rewritten to the matching screen.
 * raijin:// links pass through unchanged. Must never throw.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^raijin:/i.test(path) || path.startsWith('/')) return path;
    return linkToPath(path) ?? '/';
  } catch {
    return '/';
  }
}
