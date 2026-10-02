'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Group, Preset } from '@/types/filters';
import type { ColumnStore } from '@/lib/filters/columnStore';
import { panelToExpression } from '@/lib/filters/panel';
import { panelFromPreset } from '@/lib/filters/presets';
import { useStockStore } from '@/stores/stockStore';
import { engineFor } from './useFilterEngine';
import { LIVE_REFRESH_MS } from './useStockScreener';

/**
 * `liveVersion` changes whenever live values were folded into the columns;
 * it is part of the signature so the memo re-runs exactly then.
 */
function countMatches(
  columns: ColumnStore,
  expressions: readonly (Group | null)[],
  _liveVersion: number,
): number[] {
  useStockStore.getState().syncLiveColumns();
  const engine = engineFor(columns);
  return expressions.map(e => engine.screen(e).stats.matched);
}

/**
 * Live match counts for a set of presets, from the same engine (and cache)
 * as the screener. Presets on price-derived fields (P/E, yield, SMA
 * relations) move with the market, so counts refresh on the screener's live
 * cadence. `null` until the universe has loaded.
 */
export function usePresetCounts(presets: readonly Preset[]): readonly number[] | null {
  const columns = useStockStore(s => s.columns);
  const [liveVersion, setLiveVersion] = useState(0);
  const expressions = useMemo(
    () => presets.map(p => panelToExpression(panelFromPreset(p))),
    [presets],
  );

  useEffect(() => {
    if (!columns) return;
    const id = setInterval(() => {
      if (useStockStore.getState().syncLiveColumns() > 0) setLiveVersion(v => v + 1);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [columns]);

  return useMemo(
    () => (columns ? countMatches(columns, expressions, liveVersion) : null),
    [columns, expressions, liveVersion],
  );
}
