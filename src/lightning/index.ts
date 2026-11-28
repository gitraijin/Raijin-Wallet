import { detectConnection } from './connection';
import type { WalletBackend } from './types';

export type * from './types';

/**
 * Opens the backend for a stored connection string. Backends are imported
 * lazily so only the one in use is evaluated.
 */
export async function openBackend(uri: string): Promise<WalletBackend> {
  switch (detectConnection(uri)) {
    case 'nwc':
      return (await import('./nwc')).createNwcBackend(uri);
    case 'lndhub':
      return (await import('./lndhub')).createLndhubBackend(uri);
    case 'lnd':
      return (await import('./lnd')).createLndBackend(uri);
    case 'onchain':
      return (await import('../onchain/backend')).createOnchainBackend(uri);
    default:
      throw new Error('Unsupported connection. Use lndconnect://, nostr+walletconnect:// or lndhub://');
  }
}
