'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import { usePathname } from 'next/navigation';
import { useAfterFirstPaint } from '@/hooks/useAfterFirstPaint';
import { useStockData } from '@/hooks/useStockData';
import { useMarketFeed } from '@/hooks/useWebSocket';
import { initPerformanceObservers } from '@/lib/performance';
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';

/**
 * Client providers.
 *
 * - TanStack Query owns server state. Only the universe query is persisted
 *   (to IndexedDB, as its compact payload): a returning visitor's screener
 *   renders from disk while the network revalidates.
 * - Persisted Zustand stores rehydrate after mount, so the server render and
 *   the first client render agree (no hydration mismatch).
 * - The market data bridge keeps the universe and the feed alive across
 *   navigations.
 */

const CACHE_BUSTER = 'equitypulse-1';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 2, refetchOnWindowFocus: false },
    },
  });
}

const idbStorage =
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
    ? {
        getItem: (key: string) => get<string>(key).then(v => v ?? null),
        setItem: (key: string, value: string) => set(key, value),
        removeItem: (key: string) => del(key),
      }
    : undefined;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: idbStorage, key: 'ep:query-cache', throttleTime: 2000 }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60_000,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: query =>
            query.queryKey[0] === 'universe' && query.state.status === 'success',
        },
      }}
    >
      <StoreHydrator />
      <ThemeSync />
      <MarketDataBridge />
      {children}
    </PersistQueryClientProvider>
  );
}

function StoreHydrator() {
  useEffect(() => {
    void useFilterStore.persist.rehydrate();
    void useWatchlistStore.persist.rehydrate();
    void useUiStore.persist.rehydrate();
  }, []);
  return null;
}

function apply(pref: ThemePreference, animate: boolean): void {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = resolveTheme(pref, systemDark);
  if (document.documentElement.dataset.theme === next) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  // A theme change cross-fades instead of snapping.
  if (animate && !reduced && doc.startViewTransition)
    doc.startViewTransition(() => applyTheme(next));
  else applyTheme(next);
}

function ThemeSync() {
  useEffect(() => {
    const unsubscribe = useUiStore.subscribe((state, prev) => {
      if (state.theme === prev.theme) return;
      apply(state.theme, useUiStore.persist.hasHydrated());
      try {
        localStorage.setItem(THEME_STORAGE_KEY, state.theme);
      } catch {
        // Private mode or storage disabled: the choice lasts for the session.
      }
    });
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = (): void => {
      if (useUiStore.getState().theme === 'system') apply('system', true);
    };
    mql.addEventListener('change', onSystemChange);
    return () => {
      unsubscribe();
      mql.removeEventListener('change', onSystemChange);
    };
  }, []);
  return null;
}

function MarketDataBridge() {
  // Pages are server-rendered complete; the universe (and the live feed that
  // needs it) loads once they are on screen. The screener and watchlist are
  // that data, so they only wait for the first paint, not for idle time.
  const pathname = usePathname() ?? '/';
  const urgent = ['/screener', '/watchlist', '/heatmap'].some(p => pathname.startsWith(p));
  useStockData(useAfterFirstPaint(urgent));
  useMarketFeed();
  useEffect(() => initPerformanceObservers(), []);
  useEffect(() => {
    // Offline app shell (public/sw.js). Production only: it would cache dev bundles.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
