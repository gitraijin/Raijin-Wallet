import * as SecureStore from '@/lib/secure-store';

/**
 * Incoming payments the user already knows about, shared by the foreground
 * app and the background check, so nothing is announced twice.
 */
const SEEN_KEY = 'raijin.notify.seen.v1';
const MAX_IDS = 300;

type Seen = { nodeId: string; ids: string[] };

export async function loadSeen(nodeId: string): Promise<Set<string> | null> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    if (!raw) return null;
    const seen = JSON.parse(raw) as Seen;
    return seen.nodeId === nodeId ? new Set(seen.ids) : null;
  } catch {
    return null;
  }
}

export async function saveSeen(nodeId: string, ids: Iterable<string>): Promise<void> {
  const list = Array.from(ids).slice(0, MAX_IDS);
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify({ nodeId, ids: list } satisfies Seen));
}
