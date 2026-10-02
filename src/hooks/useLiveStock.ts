'use client';

import { useMemo } from 'react';
import type { Stock } from '@/types/market';
import { applyQuote } from '@/lib/stockFields';
import { useQuote, useStock } from '@/stores/stockStore';

/**
 * A stock with live values applied (price, change, day range, volume and every
 * price-derived ratio). Re-derives only when that symbol's quote changes.
 * Pass `fallback` (e.g. a server-rendered record) to render before the
 * universe has loaded.
 */
export function useLiveStock(
  symbol: string | null | undefined,
  fallback?: Stock,
): Stock | undefined {
  const stock = useStock(symbol) ?? fallback;
  const quote = useQuote(symbol);
  return useMemo(() => (stock && quote ? applyQuote(stock, quote) : stock), [stock, quote]);
}
