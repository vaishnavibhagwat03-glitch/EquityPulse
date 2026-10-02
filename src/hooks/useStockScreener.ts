'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { FilterNode, Group, ScreenStats } from '@/types/filters';
import type { ScreenResult } from '@/lib/filterEngine';
import type { ColumnStore } from '@/lib/filters/columnStore';
import { isLiveField } from '@/lib/filters/fields';
import type { SortSpec } from '@/lib/filters/sort';
import { panelToExpression } from '@/lib/filters/panel';
import { recordFilter, recordSort } from '@/lib/performance';
import { isScrolling } from '@/lib/scrollActivity';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useWatchlistSet, useWatchlistStore } from '@/stores/watchlistStore';
import { engineFor } from './useFilterEngine';

/**
 * The screener's query pipeline: panel state → expression → engine → sorted
 * row positions.
 *
 * - Inputs are deferred (`useDeferredValue`), so dragging a slider keeps the
 *   control at 60 fps while results catch up in a lower-priority render.
 * - The result is memoised on everything it depends on; a price tick alone
 *   never re-screens.
 * - When the screen or sort involves live fields (price, change, P/E…), live
 *   values are folded into the columns and the screen re-runs every
 *   LIVE_REFRESH_MS, so membership tracks the market without reshuffling rows
 *   on every tick — and never while the user is scrolling the results.
 */

export const LIVE_REFRESH_MS = 2000;

const EMPTY_STATS: ScreenStats = {
  total: 0,
  matched: 0,
  conditionCount: 0,
  cacheHits: 0,
  cacheMisses: 0,
  timings: { compileMs: 0, evaluateMs: 0, sortMs: 0, totalMs: 0 },
};

export interface ScreenerResult {
  rows: Uint32Array;
  stats: ScreenStats;
  issues: string[];
  expression: Group | null;
  /** The screen or the sort reads live fields (re-evaluated every LIVE_REFRESH_MS). */
  live: boolean;
  /** The filters themselves read live fields: membership can change as prices move. */
  liveFilter: boolean;
  ready: boolean;
  pending: boolean;
}

export function dependsOnLive(node: FilterNode | null): boolean {
  if (!node) return false;
  if (node.kind === 'condition')
    return !node.disabled && (isLiveField(node.field) || isLiveField(node.compareTo));
  return node.children.some(dependsOnLive);
}

/**
 * One screen. `_liveTick` is part of the signature so the memo above re-runs
 * when a live refresh folded new prices into the columns.
 */
function runScreen(
  columns: ColumnStore,
  expression: Group | null,
  sort: SortSpec | null,
  watchlist: ReadonlySet<string>,
  watchlistVersion: number,
  _liveTick: number,
): ScreenResult {
  // Fold in live values received since the last screen (idempotent; a no-op
  // when nothing moved) so a fresh screen sees current prices.
  useStockStore.getState().syncLiveColumns();
  const r = engineFor(columns).screen(expression, { ctx: { watchlist, watchlistVersion }, sort });
  recordFilter(r.stats.timings.evaluateMs);
  if (sort) recordSort(r.stats.timings.sortMs);
  return r;
}

export function useStockScreener(): ScreenerResult {
  const columns = useStockStore(s => s.columns);
  const panel = useFilterStore(s => s.panel);
  const search = useFilterStore(s => s.search);
  const watchlistOnly = useFilterStore(s => s.watchlistOnly);
  const sort = useFilterStore(s => s.sort);
  const watchlist = useWatchlistSet();
  const watchlistVersion = useWatchlistStore(s => s.version);

  const deferredPanel = useDeferredValue(panel);
  const deferredSearch = useDeferredValue(search);
  const pending = deferredPanel !== panel || deferredSearch !== search;

  const expression = useMemo(
    () => panelToExpression(deferredPanel, { search: deferredSearch, watchlistOnly }),
    [deferredPanel, deferredSearch, watchlistOnly],
  );
  const liveFilter = useMemo(() => dependsOnLive(expression), [expression]);
  const live = liveFilter || isLiveField(sort?.field);

  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      // Never reorder rows under a scrolling user; the next tick after the pause catches up.
      if (isScrolling()) return;
      if (useStockStore.getState().syncLiveColumns() > 0) setLiveTick(t => t + 1);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [live]);

  const result = useMemo(
    () =>
      columns ? runScreen(columns, expression, sort, watchlist, watchlistVersion, liveTick) : null,
    [columns, expression, sort, watchlist, watchlistVersion, liveTick],
  );

  return {
    rows: result?.indices ?? new Uint32Array(0),
    stats: result?.stats ?? EMPTY_STATS,
    issues: result?.issues ?? [],
    expression,
    live,
    liveFilter,
    ready: Boolean(columns),
    pending,
  };
}
