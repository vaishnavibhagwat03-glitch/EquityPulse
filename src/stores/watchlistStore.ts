import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Watched securities, persisted locally. `version` feeds the filter cache key. */

export interface WatchItem {
  symbol: string;
  addedAt: number;
}

export interface WatchlistState {
  items: WatchItem[];
  version: number;
  add(symbol: string): void;
  remove(symbol: string): void;
  toggle(symbol: string): boolean;
  clear(): void;
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      items: [],
      version: 0,
      add(symbol) {
        if (get().items.some(i => i.symbol === symbol)) return;
        set(s => ({
          items: [{ symbol, addedAt: Date.now() }, ...s.items],
          version: s.version + 1,
        }));
      },
      remove(symbol) {
        set(s => ({ items: s.items.filter(i => i.symbol !== symbol), version: s.version + 1 }));
      },
      toggle(symbol) {
        const watched = get().items.some(i => i.symbol === symbol);
        if (watched) get().remove(symbol);
        else get().add(symbol);
        return !watched;
      },
      clear() {
        set(s => ({ items: [], version: s.version + 1 }));
      },
    }),
    {
      name: 'ep:watchlist',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: s => ({ items: s.items }),
    },
  ),
);

export const useIsWatched = (symbol: string | null | undefined): boolean =>
  useWatchlistStore(s => (symbol ? s.items.some(i => i.symbol === symbol) : false));

export function useWatchlistSet(): ReadonlySet<string> {
  const items = useWatchlistStore(s => s.items);
  return useMemo(() => new Set(items.map(i => i.symbol)), [items]);
}
