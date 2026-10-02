'use client';

import { useSyncExternalStore } from 'react';

interface PersistedStore {
  persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void };
}

/**
 * True once a persisted Zustand store has rehydrated from storage. Lets a view
 * tell "empty" from "not loaded yet" (no flash of an empty watchlist).
 */
export function useHydrated(store: PersistedStore): boolean {
  return useSyncExternalStore(
    onChange => store.persist.onFinishHydration(onChange),
    () => store.persist.hasHydrated(),
    () => false,
  );
}
