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

import { errorMessage } from '@/lib/format';
import { emitPaymentReceived } from '@/motion/payments';
import * as store from '@/lib/nodes';
import type { NodeEntry } from '@/lib/nodes';
import {
  type BalanceBreakdown,
  openBackend,
  type WalletBackend,
  type WalletPayment,
} from '@/lightning';

export type { NodeEntry } from '@/lib/nodes';

export type WalletStatus =
  | 'loading' // reading secure storage
  | 'empty' // no node on this device yet
  | 'connecting' // backend is starting up
  | 'ready'
  | 'error';

type WalletState = {
  status: WalletStatus;
  error: string | null;
  balanceSats: bigint;
  breakdown: BalanceBreakdown | null;
  payments: WalletPayment[];
  lastSyncedAt: Date | null;
  nodes: NodeEntry[];
  activeNodeId: string | null;
};

type WalletContextValue = WalletState & {
  /** The connected backend. Only non-null while status === 'ready'. */
  backend: WalletBackend | null;
  activeNode: NodeEntry | null;
  /**
   * Verifies the connection, stores the node and switches to it. Throws if the
   * node cannot be reached; the current node stays connected in that case.
   */
  addNode: (name: string, uri: string) => Promise<void>;
  switchNode: (id: string) => Promise<void>;
  renameNode: (id: string, name: string) => Promise<void>;
  /** Deletes the node from this device. Returns how many nodes remain. */
  removeNode: (id: string) => Promise<number>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const NO_DATA = { balanceSats: 0n, breakdown: null, payments: [], lastSyncedAt: null };

const INITIAL_STATE: WalletState = {
  status: 'loading',
  error: null,
  ...NO_DATA,
  nodes: [],
  activeNodeId: null,
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(INITIAL_STATE);
  const backendRef = useRef<WalletBackend | null>(null);
  const unsubscribeRef = useRef<(() => Promise<void> | void) | null>(null);
  // Bumped on every connect/switch, so a slow connection that finishes after
  // the user picked another node is dropped instead of taking over.
  const generationRef = useRef(0);
  // Incoming payments already seen (complete), per connection. null = first
  // snapshot not taken yet, which must not announce old payments.
  const seenRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const backend = backendRef.current;
    if (!backend) return;
    const generation = generationRef.current;
    try {
      const snapshot = await backend.getSnapshot();
      if (generation !== generationRef.current) return;
      const received = snapshot.payments.filter((p) => p.direction === 'in' && p.state === 'complete');
      if (seenRef.current) {
        for (const payment of received) {
          if (seenRef.current.has(payment.id)) continue;
          emitPaymentReceived({
            amountSats: payment.amountSats,
            source: payment.rail === 'onchain' ? 'onchain' : 'lightning',
            description: payment.description,
          });
        }
      }
      seenRef.current = new Set(received.map((p) => p.id));
      setState((prev) => ({ ...prev, ...snapshot }));
    } catch (error) {
      console.warn('[wallet] refresh failed', error);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const backend = backendRef.current;
    const unsubscribe = unsubscribeRef.current;
    backendRef.current = null;
    unsubscribeRef.current = null;
    seenRef.current = null;
    if (!backend) return;
    try {
      await unsubscribe?.();
      await backend.disconnect();
    } catch (error) {
      console.warn('[wallet] disconnect failed', error);
    }
  }, []);

  /** Makes an opened backend the active one, unless a newer connect superseded it. */
  const activate = useCallback(
    async (backend: WalletBackend, generation: number) => {
      if (generation !== generationRef.current) {
        await backend.disconnect().catch(() => {});
        return;
      }
      await disconnect();
      backendRef.current = backend;
      unsubscribeRef.current = await backend.subscribe(() => void refresh());
      await refresh();
      if (generation === generationRef.current) {
        setState((prev) => ({ ...prev, status: 'ready', error: null }));
      }
    },
    [refresh, disconnect],
  );

  /** Connects to a stored node. Errors end up in state. */
  const connect = useCallback(
    async (id: string) => {
      const generation = ++generationRef.current;
      await disconnect();
      setState((prev) => ({ ...prev, ...NO_DATA, status: 'connecting', error: null, activeNodeId: id }));
      try {
        const uri = await store.loadNodeUri(id);
        if (!uri) throw new Error('Connection string missing from the keystore');
        await activate(await openBackend(uri), generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        await disconnect();
        setState((prev) => ({ ...prev, status: 'error', error: errorMessage(error) }));
      }
    },
    [activate, disconnect],
  );

  // On launch: connect to the active node if there is one.
  useEffect(() => {
    let cancelled = false;
    const generation = generationRef; // a counter, not a DOM node
    (async () => {
      const index = await store.loadNodeIndex();
      if (cancelled) return;
      setState((prev) => ({ ...prev, nodes: index.nodes, activeNodeId: index.activeId }));
      if (index.activeId) {
        await connect(index.activeId);
      } else {
        setState((prev) => ({ ...prev, status: 'empty' }));
      }
    })();
    return () => {
      cancelled = true;
      generation.current++;
      void disconnect();
    };
  }, [connect, disconnect]);

  const addNode = useCallback(
    async (name: string, uri: string) => {
      // Verify before storing, so a typo never ends up in the keystore.
      const backend = await openBackend(uri);
      let stored: Awaited<ReturnType<typeof store.addNode>>;
      try {
        stored = await store.addNode(name.trim() || backend.info.label, uri);
      } catch (error) {
        await backend.disconnect().catch(() => {});
        throw error;
      }
      const generation = ++generationRef.current;
      setState((prev) => ({
        ...prev,
        ...NO_DATA,
        status: 'connecting',
        error: null,
        nodes: stored.index.nodes,
        activeNodeId: stored.node.id,
      }));
      // The node is saved now; later failures show as a connection error with retry.
      try {
        await activate(backend, generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        await disconnect();
        setState((prev) => ({ ...prev, status: 'error', error: errorMessage(error) }));
      }
    },
    [activate, disconnect],
  );

  const switchNode = useCallback(
    async (id: string) => {
      // Synchronously, so screens that navigate right after see 'connecting'.
      setState((prev) => ({ ...prev, ...NO_DATA, status: 'connecting', error: null, activeNodeId: id }));
      const index = await store.setActiveNode(id);
      setState((prev) => ({ ...prev, nodes: index.nodes }));
      await connect(id);
    },
    [connect],
  );

  const renameNode = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const index = await store.renameNode(id, trimmed);
    setState((prev) => ({ ...prev, nodes: index.nodes }));
  }, []);

  const removeNode = useCallback(
    async (id: string) => {
      const wasActive = state.activeNodeId === id;
      const index = await store.removeNode(id);
      setState((prev) => ({ ...prev, nodes: index.nodes, activeNodeId: index.activeId }));
      if (wasActive) {
        if (index.activeId) {
          await connect(index.activeId);
        } else {
          generationRef.current++;
          await disconnect();
          setState({ ...INITIAL_STATE, status: 'empty' });
        }
      }
      return index.nodes.length;
    },
    [state.activeNodeId, connect, disconnect],
  );

  const retry = useCallback(async () => {
    if (state.activeNodeId) await connect(state.activeNodeId);
  }, [state.activeNodeId, connect]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      backend: state.status === 'ready' ? backendRef.current : null,
      activeNode: state.nodes.find((n) => n.id === state.activeNodeId) ?? null,
      addNode,
      switchNode,
      renameNode,
      removeNode,
      refresh,
      retry,
    }),
    [state, addNode, switchNode, renameNode, removeNode, refresh, retry],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
