import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from '@/lib/secure-store';

import { type ConnectionKind, detectConnection } from '@/lightning/connection';

/**
 * Saved nodes. The connection string of each node (lndconnect://,
 * nostr+walletconnect://, lndhub://) grants spending rights, so everything
 * lives in the device keystore: a small index (ids, names, active id) plus one
 * entry per connection string, which keeps each value well below the
 * keystore's size limits.
 */
export type NodeEntry = { id: string; name: string; kind: ConnectionKind };

type NodeIndex = { nodes: NodeEntry[]; activeId: string | null };

const INDEX_KEY = 'raijin.nodes.v1';
const uriKey = (id: string) => `raijin.node.${id}.uri`;

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const EMPTY: NodeIndex = { nodes: [], activeId: null };

function newId(): string {
  return Array.from(getRandomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadNodeIndex(): Promise<NodeIndex> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY, STORE_OPTIONS);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as NodeIndex;
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const activeId = nodes.some((n) => n.id === parsed.activeId) ? parsed.activeId : (nodes[0]?.id ?? null);
    return { nodes, activeId };
  } catch {
    return EMPTY;
  }
}

async function saveNodeIndex(index: NodeIndex): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(index), STORE_OPTIONS);
}

export async function loadNodeUri(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(uriKey(id), STORE_OPTIONS);
}

/** Stores a new node and makes it the active one. */
export async function addNode(name: string, uri: string): Promise<{ node: NodeEntry; index: NodeIndex }> {
  const trimmed = uri.trim();
  const kind = detectConnection(trimmed);
  if (!kind) throw new Error('Unsupported connection string');
  const node: NodeEntry = { id: newId(), name, kind };
  // Secret first: an index entry must never point at a missing connection string.
  await SecureStore.setItemAsync(uriKey(node.id), trimmed, STORE_OPTIONS);
  const current = await loadNodeIndex();
  const index = { nodes: [...current.nodes, node], activeId: node.id };
  await saveNodeIndex(index);
  return { node, index };
}

export async function setActiveNode(id: string): Promise<NodeIndex> {
  const current = await loadNodeIndex();
  if (!current.nodes.some((n) => n.id === id)) throw new Error('Unknown node');
  const index = { ...current, activeId: id };
  await saveNodeIndex(index);
  return index;
}

export async function renameNode(id: string, name: string): Promise<NodeIndex> {
  const current = await loadNodeIndex();
  const index = {
    ...current,
    nodes: current.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
  };
  await saveNodeIndex(index);
  return index;
}

/** Removes a node; if it was active, the first remaining node becomes active. */
export async function removeNode(id: string): Promise<NodeIndex> {
  const current = await loadNodeIndex();
  const nodes = current.nodes.filter((n) => n.id !== id);
  const activeId = current.activeId === id ? (nodes[0]?.id ?? null) : current.activeId;
  const index = { nodes, activeId };
  await saveNodeIndex(index);
  await SecureStore.deleteItemAsync(uriKey(id), STORE_OPTIONS);
  return index;
}
