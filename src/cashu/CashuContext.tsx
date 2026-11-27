import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import * as store from './store';
import type { CashuEntry, CashuMint } from './store';
import { balanceOf, type MintPreview, reconcile } from './wallet';

export type { CashuEntry, CashuMint } from './store';

type CashuContextValue = {
  loaded: boolean;
  mints: CashuMint[];
  /** Sats per mint id. */
  balances: Record<string, bigint>;
  totalSats: bigint;
  history: CashuEntry[];
  /** Mint the screens act on; the first mint unless the user picked another. */
  selectedMint: CashuMint | null;
  selectMint: (id: string) => void;
  /** Re-reads balances and history from the store. */
  reload: () => Promise<void>;
  /** Asks the mints about spent proofs, sent tokens and pending deposits, then reloads. */
  sync: () => Promise<void>;
  addMint: (preview: MintPreview) => Promise<CashuMint>;
  renameMint: (id: string, name: string) => Promise<void>;
  /** Deletes the mint and all its ecash from this device. */
  removeMint: (id: string) => Promise<void>;
  mintById: (id: string) => CashuMint | undefined;
};

const CashuContext = createContext<CashuContextValue | null>(null);

type StoredState = { mints: CashuMint[]; balances: Record<string, bigint>; history: CashuEntry[] };

async function readState(): Promise<StoredState> {
  const mints = await store.loadMints();
  const balances: Record<string, bigint> = {};
  for (const mint of mints) {
    try {
      balances[mint.id] = await balanceOf(mint.id);
    } catch (error) {
      console.warn('[cashu] cannot read proofs', mint.url, error);
      balances[mint.id] = 0n;
    }
  }
  return { mints, balances, history: await store.loadHistory() };
}

export function CashuProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [mints, setMints] = useState<CashuMint[]>([]);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [history, setHistory] = useState<CashuEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const apply = useCallback((next: StoredState) => {
    setMints(next.mints);
    setBalances(next.balances);
    setHistory(next.history);
    setLoaded(true);
  }, []);

  const reload = useCallback(async () => apply(await readState()), [apply]);

  useEffect(() => {
    let cancelled = false;
    readState().then((next) => !cancelled && apply(next));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const sync = useCallback(async () => {
    const list = await store.loadMints();
    await Promise.all(
      list.map((mint) => reconcile(mint).catch((error) => console.warn('[cashu] sync failed', mint.url, error))),
    );
    await reload();
  }, [reload]);

  const addMint = useCallback(
    async (preview: MintPreview) => {
      const list = await store.loadMints();
      const existing = list.find((m) => m.url === preview.url);
      if (existing) return existing;
      const mint: CashuMint = { id: store.newId(), url: preview.url, name: preview.name, addedAt: Date.now() };
      await store.saveMints([...list, mint]);
      await reload();
      return mint;
    },
    [reload],
  );

  const renameMint = useCallback(
    async (id: string, name: string) => {
      const list = await store.loadMints();
      await store.saveMints(list.map((m) => (m.id === id ? { ...m, name } : m)));
      await reload();
    },
    [reload],
  );

  const removeMint = useCallback(
    async (id: string) => {
      const list = await store.loadMints();
      await store.saveMints(list.filter((m) => m.id !== id));
      await store.removeMintData(id);
      setSelectedId((current) => (current === id ? null : current));
      await reload();
    },
    [reload],
  );

  const value = useMemo<CashuContextValue>(() => {
    const selectedMint = mints.find((m) => m.id === selectedId) ?? mints[0] ?? null;
    const totalSats = Object.values(balances).reduce((sum, b) => sum + b, 0n);
    return {
      loaded,
      mints,
      balances,
      totalSats,
      history,
      selectedMint,
      selectMint: setSelectedId,
      reload,
      sync,
      addMint,
      renameMint,
      removeMint,
      mintById: (id) => mints.find((m) => m.id === id),
    };
  }, [loaded, mints, balances, history, selectedId, reload, sync, addMint, renameMint, removeMint]);

  return <CashuContext.Provider value={value}>{children}</CashuContext.Provider>;
}

export function useCashu(): CashuContextValue {
  const ctx = useContext(CashuContext);
  if (!ctx) throw new Error('useCashu must be used inside <CashuProvider>');
  return ctx;
}
