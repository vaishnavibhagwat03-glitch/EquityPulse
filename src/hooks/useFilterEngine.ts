'use client';

import { FilterEngine } from '@/lib/filterEngine';
import type { ColumnStore } from '@/lib/filters/columnStore';
import { useStockStore } from '@/stores/stockStore';

/**
 * One engine for the page lifetime. Keeping it outside React means its
 * condition cache survives navigating away from the screener and back: the
 * same screen re-runs from cache.
 */
let engine: FilterEngine | null = null;

export function engineFor(columns: ColumnStore): FilterEngine {
  if (!engine) engine = new FilterEngine(columns);
  else engine.setStore(columns);
  return engine;
}

export function useFilterEngine(): FilterEngine | null {
  const columns = useStockStore(s => s.columns);
  return columns ? engineFor(columns) : null;
}
