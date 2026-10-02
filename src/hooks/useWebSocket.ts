'use client';

import { useEffect } from 'react';
import { feedController } from '@/lib/feed/controller';
import { useStockStore } from '@/stores/stockStore';

/**
 * Keeps the market feed connected for the lifetime of the app shell.
 * Mounted once in the providers, so navigating between pages never drops the
 * connection or the live state.
 */
export function useMarketFeed(): void {
  const universe = useStockStore(s => s.universe);

  useEffect(() => {
    feedController.acquire();
    return () => feedController.release();
  }, []);

  useEffect(() => {
    if (universe) feedController.provideUniverse(universe);
  }, [universe]);
}

export { feedController };
