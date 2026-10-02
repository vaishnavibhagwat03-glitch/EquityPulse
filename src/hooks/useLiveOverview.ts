'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MarketOverview } from '@/types/market';
import { useFeedStore } from '@/stores/feedStore';

/**
 * The market overview, live. Starts from the server-rendered snapshot (so the
 * first paint is complete and real) and switches to the feed's ~1 Hz
 * aggregates as soon as they arrive.
 */
export function useLiveOverview(
  snapshot: MarketOverview,
): MarketOverview & { live: boolean; asOf: number } {
  const market = useFeedStore(s => s.market);
  const marketTs = useFeedStore(s => s.marketTs);
  return useMemo(() => {
    if (!market) return { ...snapshot, live: false };
    const liveIndex = new Map(market.indices.map(i => [i.id, i]));
    const liveSector = new Map(market.sectors.map(s => [s.name, s]));
    return {
      asOf: marketTs ?? snapshot.asOf,
      live: true,
      breadth: market.breadth,
      distribution: market.distribution,
      movers: market.movers,
      indices: snapshot.indices.map(i => {
        const l = liveIndex.get(i.id);
        return l
          ? {
              ...i,
              value: l.value,
              change: l.change,
              changePercent: l.changePercent,
              advancing: l.advancing,
              declining: l.declining,
            }
          : i;
      }),
      sectors: snapshot.sectors
        .map(s => {
          const l = liveSector.get(s.name);
          return l
            ? {
                ...s,
                changePercent: l.changePercent,
                advancing: l.advancing,
                declining: l.declining,
              }
            : s;
        })
        .sort((a, b) => b.changePercent - a.changePercent),
    };
  }, [snapshot, market, marketTs]);
}

const BAR_MS = 5 * 60_000;

/**
 * An index's intraday line on its 5-minute grid: the server's session path,
 * with the current bar following the live level and a new bar appended when
 * the clock crosses into the next five minutes — so the x-axis stays time.
 */
export function useIndexTrail(id: string, intraday: readonly number[]): number[] {
  const [trail, setTrail] = useState<number[]>(() => [...intraday]);
  const cap = intraday.length + 12;
  useEffect(() => {
    let bar = Math.floor(Date.now() / BAR_MS);
    let lastTs: number | null = null;
    return useFeedStore.subscribe(state => {
      if (!state.market || state.marketTs === lastTs) return;
      lastTs = state.marketTs;
      const value = state.market.indices.find(i => i.id === id)?.value;
      if (value === undefined) return;
      const now = Math.floor(Date.now() / BAR_MS);
      const append = now > bar;
      bar = now;
      setTrail(prev => {
        const next = prev.slice();
        if (append || next.length === 0) {
          next.push(value);
          if (next.length > cap) next.shift();
        } else {
          next[next.length - 1] = value;
        }
        return next;
      });
    });
  }, [id, cap]);
  return trail;
}
