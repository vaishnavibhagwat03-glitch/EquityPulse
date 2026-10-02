'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Universe } from '@/types/market';
import { api, queryKeys, type ApiResult } from '@/lib/api';
import { setGauge } from '@/lib/performance';
import { decodeUniverse, type CompactUniverse } from '@/lib/universeCodec';
import { useStockStore } from '@/stores/stockStore';

/**
 * Loads the universe. The query caches (and persists to IndexedDB) the compact
 * payload; decoding into Stock objects happens once per payload in `select`,
 * then the store builds the filter engine's columns.
 */

let lastDecoded: { source: CompactUniverse; universe: Universe } | null = null;

function selectUniverse(result: ApiResult<CompactUniverse>): Universe {
  // `select` can re-run for the same payload (new observers); decode once.
  if (lastDecoded?.source === result.data) return lastDecoded.universe;
  const t0 = performance.now();
  const universe = decodeUniverse(result.data);
  setGauge('universeDecodeMs', Math.round((performance.now() - t0) * 10) / 10);
  setGauge('universeSize', universe.stocks.length);
  lastDecoded = { source: result.data, universe };
  return universe;
}

/**
 * `enabled: false` defers only the network request: a universe restored from
 * IndexedDB (a return visit) is still served immediately.
 */
export function useUniverseQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.universe,
    queryFn: ({ signal }) => api.universe(signal),
    enabled,
    select: selectUniverse,
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 3,
    retryDelay: attempt => Math.min(8000, 600 * 2 ** attempt),
  });
}

/** Mounted once by the app providers; pushes the universe into the store. */
export function useStockData(enabled = true) {
  const query = useUniverseQuery(enabled);
  const universe = query.data;
  useEffect(() => {
    if (universe) useStockStore.getState().setUniverse(universe);
  }, [universe]);
  return query;
}
