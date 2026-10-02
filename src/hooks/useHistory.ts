'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { HistoryInterval } from '@/types/market';
import { api, queryKeys } from '@/lib/api';
import { useStockStore } from '@/stores/stockStore';

/** Daily bars fetched for every daily view: 1Y visible plus SMA 200 warm-up. */
export const DAILY_LIMIT = 520;
export const WEEKLY_LIMIT = 330;

const LIMITS: Record<HistoryInterval, number | undefined> = {
  '1d': DAILY_LIMIT,
  '1w': WEEKLY_LIMIT,
  '5m': undefined,
  '15m': undefined,
};

/**
 * OHLCV history for a symbol. Daily and weekly bars are fixed for the day
 * (long staleTime); intraday bars refresh with the clock. If the server has
 * rolled to a new trading day (different universe version), the universe is
 * refetched so the snapshot and the chart can never disagree.
 */
export function useHistory(
  symbol: string | null | undefined,
  interval: HistoryInterval,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.history(symbol ?? '', interval),
    queryFn: ({ signal }) => api.history(symbol!, interval, LIMITS[interval], signal),
    enabled: Boolean(symbol) && enabled,
    staleTime: interval === '1d' || interval === '1w' ? 30 * 60_000 : 60_000,
    gcTime: 10 * 60_000,
  });

  const serverVersion = query.data?.meta.version;
  useEffect(() => {
    const local = useStockStore.getState().universe?.meta.version;
    if (serverVersion && local && serverVersion !== local) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.universe });
    }
  }, [serverVersion, queryClient]);

  return query;
}
