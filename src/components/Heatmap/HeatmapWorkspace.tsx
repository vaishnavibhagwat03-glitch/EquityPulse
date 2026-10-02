'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { Stock } from '@/types/market';
import { formatPercent } from '@/lib/format';
import { useStockStore } from '@/stores/stockStore';
import { Skeleton } from '@/components/ui/primitives';

/**
 * Market heatmap: each sector's largest companies as tiles, sized by market
 * cap and coloured by live day change. Re-renders once per feed batch.
 */

const PER_SECTOR = 15;
/** Change at which a tile reaches full colour, %. */
const SATURATE_AT = 3;

/** Tile background for a day change: neutral at 0, full red/green at ±SATURATE_AT. */
export function heatColor(changePercent: number): string {
  const t = Math.min(Math.abs(changePercent) / SATURATE_AT, 1);
  if (t < 0.02) return 'var(--surface-active)';
  const tone = changePercent > 0 ? 'var(--positive)' : 'var(--negative)';
  return `color-mix(in oklab, ${tone} ${Math.round(15 + t * 40)}%, var(--surface))`;
}

interface Group {
  sector: string;
  stocks: Stock[];
  marketCap: number;
}

export function groupBySector(stocks: readonly Stock[], perSector = PER_SECTOR): Group[] {
  const map = new Map<string, Stock[]>();
  for (const s of stocks) {
    const list = map.get(s.sector);
    if (list) list.push(s);
    else map.set(s.sector, [s]);
  }
  return [...map]
    .map(([sector, list]) => {
      const top = list.sort((a, b) => b.marketCap - a.marketCap).slice(0, perSector);
      return { sector, stocks: top, marketCap: top.reduce((n, s) => n + s.marketCap, 0) };
    })
    .sort((a, b) => b.marketCap - a.marketCap);
}

export function HeatmapWorkspace() {
  const stocks = useStockStore(s => s.stocks);
  const quotes = useStockStore(s => s.quotes);
  useStockStore(s => s.quoteVersion); // re-render on each feed batch
  const groups = useMemo(() => groupBySector(stocks), [stocks]);

  return (
    <section aria-labelledby="heatmap-title" className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 id="heatmap-title" className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Heatmap
        </h1>
        <p className="text-[12px] text-muted">
          Top {PER_SECTOR} companies per sector by market cap · tile size = market cap · colour =
          day change
        </p>
        <Legend />
      </header>

      {groups.length === 0 ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(group => (
            <section
              key={group.sector}
              aria-label={group.sector}
              className="rounded-md border border-line bg-surface p-2"
            >
              <h2 className="mb-1.5 px-0.5 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
                {group.sector}
              </h2>
              <ul className="flex flex-wrap gap-0.5">
                {group.stocks.map(stock => {
                  const change = quotes.get(stock.symbol)?.changePercent ?? stock.changePercent;
                  const label = formatPercent(change, { decimals: 2, signed: true });
                  return (
                    <li
                      key={stock.symbol}
                      className="min-w-[64px]"
                      style={{ flexGrow: Math.sqrt(stock.marketCap / group.marketCap) * 10 }}
                    >
                      <Link
                        href={`/${encodeURIComponent(stock.symbol)}`}
                        aria-label={`${stock.name} (${stock.symbol}) ${label}`}
                        title={`${stock.name} · ${label}`}
                        className="flex h-14 flex-col justify-center rounded-sm px-1.5 text-ink transition-[filter] hover:brightness-95 focus-visible:relative focus-visible:z-10"
                        style={{ background: heatColor(change) }}
                      >
                        <span className="truncate text-[11.5px] font-semibold">{stock.symbol}</span>
                        <span className="num text-[11px]">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

const LEGEND_STEPS = [-3, -2, -1, 0, 1, 2, 3];

const legendLabel = (step: number): string =>
  step <= -SATURATE_AT
    ? `≤ −${SATURATE_AT}%`
    : step >= SATURATE_AT
      ? `≥ +${SATURATE_AT}%`
      : `${step > 0 ? '+' : ''}${step}%`;

/** Colour scale key, so colour is never the only way to read a tile (each tile also shows its %). */
function Legend() {
  return (
    <div
      className="ml-auto flex items-center gap-1 text-[10.5px] text-muted"
      role="group"
      aria-label="Colour scale"
    >
      {LEGEND_STEPS.map(step => (
        <span key={step} className="flex flex-col items-center gap-0.5">
          <span
            aria-hidden
            className="h-2.5 w-7 rounded-[2px] border border-line"
            style={{ background: heatColor(step) }}
          />
          <span className="num">{legendLabel(step)}</span>
        </span>
      ))}
    </div>
  );
}
