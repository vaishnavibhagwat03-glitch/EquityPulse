'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import {
  direction,
  formatInr,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatPrice,
} from '@/lib/format';
import { decodeSparkline } from '@/lib/sparkline';
import { useHistory } from '@/hooks/useHistory';
import { useHydrated } from '@/hooks/useHydrated';
import { useLiveStock } from '@/hooks/useLiveStock';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsWatched, useWatchlistStore } from '@/stores/watchlistStore';
import { MiniChart } from '@/components/StockDetail/MiniChart';
import { Button } from '@/components/ui/Button';
import { ChangeText, Skeleton } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/Sparkline';
import { emergeStyle } from './emerge';
import { SectionHead } from './SectionHead';

/* --------------------------------------------------------------- analyze */

/**
 * One security in focus: the last one the visitor analysed, or else the
 * session's most active. Price and ratios are live; the chart is three months
 * of daily closes.
 */
export function Spotlight({ fallbackSymbol, emerge }: { fallbackSymbol: string; emerge: number }) {
  const uiHydrated = useHydrated(useUiStore);
  const recent = useUiStore(s => s.recent[0] ?? null);
  const symbol = (uiHydrated && recent) || fallbackSymbol;
  const stock = useLiveStock(symbol);
  const history = useHistory(symbol, '1d');
  const candles = history.data?.data.candles.slice(-66);
  const watched = useIsWatched(symbol);
  const toggleWatch = useWatchlistStore(s => s.toggle);

  const metrics = stock
    ? [
        { label: 'Market cap', value: formatMarketCap(stock.marketCap) },
        { label: 'P/E', value: stock.pe === null ? 'n/m' : formatNumber(stock.pe, 1) },
        { label: 'ROE', value: formatPercent(stock.roe, { decimals: 1 }) },
        { label: 'RSI 14', value: formatNumber(stock.rsi14, 1) },
      ]
    : [];

  return (
    <section
      data-emerge
      style={emergeStyle(emerge)}
      aria-labelledby="analyze-title"
      className="col-span-12 flex min-w-0 flex-col bg-surface lg:col-span-7"
    >
      <SectionHead step="04" title="Analyze" id="analyze-title" className="border-b border-line">
        <span className="truncate">
          {uiHydrated && recent ? 'Continue where you left off' : 'Most active by turnover'}
        </span>
      </SectionHead>
      <div className="grid flex-1 gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {stock ? (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="min-w-0">
              <p className="flex items-baseline gap-2">
                <Link
                  href={`/${encodeURIComponent(stock.symbol)}`}
                  className="num text-[15px] font-semibold text-ink hover:underline"
                >
                  {stock.symbol}
                </Link>
                <span className="text-[10.5px] tracking-[0.06em] text-faint uppercase">
                  {stock.exchange}
                </span>
              </p>
              <p className="truncate text-[12.5px] text-muted">{stock.name}</p>
            </div>
            <p className="flex items-baseline gap-2.5">
              <span className="num text-[24px] leading-none tracking-[-0.02em] text-ink">
                {formatInr(stock.price)}
              </span>
              <ChangeText value={stock.changePercent} className="text-[12.5px]" />
            </p>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12px]">
              {metrics.map(m => (
                <div
                  key={m.label}
                  className="flex items-baseline justify-between gap-2 border-b border-line-subtle pb-1.5"
                >
                  <dt className="text-muted">{m.label}</dt>
                  <dd className="num text-ink">{m.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <Link
                href={`/${encodeURIComponent(stock.symbol)}`}
                className="inline-flex h-8 press items-center gap-2 rounded-md bg-surface-inverse px-3 text-[12.5px] font-medium text-ink-inverse transition-opacity duration-150 hover:opacity-90"
              >
                Open chart
              </Link>
              <Button
                size="md"
                variant="secondary"
                icon={watched ? 'star-filled' : 'star'}
                onClick={() => toggleWatch(stock.symbol)}
                aria-pressed={watched}
              >
                {watched ? 'Watching' : 'Watch'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        <div className="flex min-w-0 flex-col justify-end gap-1.5">
          <p className="flex justify-between num text-[10.5px] text-faint">
            <span>3 months · daily close</span>
            {candles?.length && stock ? (
              <ChangeText
                value={(stock.price / candles[0]!.close - 1) * 100}
                className="text-[10.5px]"
              />
            ) : null}
          </p>
          <MiniChart
            candles={candles}
            livePrice={stock?.price}
            height={132}
            label={`${symbol} three-month closing prices`}
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- discover */

const PREVIEW_LIMIT = 6;

function WatchRow({ symbol }: { symbol: string }) {
  const stock = useLiveStock(symbol);
  if (!stock) {
    return (
      <li className="flex h-10 items-center gap-3 px-4" aria-hidden>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-20" />
      </li>
    );
  }
  const dir = direction(stock.changePercent);
  return (
    <li>
      <Link
        href={`/${encodeURIComponent(symbol)}`}
        className="grid h-10 grid-cols-[minmax(0,1fr)_56px_76px_60px] items-center gap-3 px-4 transition-colors duration-150 hover:bg-surface-hover"
      >
        <span className="min-w-0">
          <span className="block truncate num text-[12px] font-semibold text-ink">{symbol}</span>
          <span className="block truncate text-[10.5px] text-faint">{stock.name}</span>
        </span>
        <Sparkline
          values={decodeSparkline(stock.spark)}
          width={56}
          height={20}
          tone={dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}
        />
        <span className="text-right num text-[12px] text-ink">{formatPrice(stock.price)}</span>
        <ChangeText value={stock.changePercent} className="text-right text-[12px]" />
      </Link>
    </li>
  );
}

export function WatchPreview({ onBrowse, emerge }: { onBrowse: () => void; emerge: number }) {
  const hydrated = useHydrated(useWatchlistStore);
  const items = useWatchlistStore(s => s.items);
  const loaded = useStockStore(s => s.stocks.length > 0);
  const shown = items.slice(0, PREVIEW_LIMIT);

  return (
    <section
      data-emerge
      style={emergeStyle(emerge)}
      aria-labelledby="discover-title"
      className="col-span-12 flex min-w-0 flex-col bg-surface lg:col-span-5"
    >
      <SectionHead step="05" title="Discover" id="discover-title" className="border-b border-line">
        <span>Your watchlist</span>
      </SectionHead>
      {!hydrated || (items.length > 0 && !loaded) ? (
        <ul className="py-1">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex h-10 items-center gap-3 px-4" aria-hidden>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="ml-auto h-3 w-24" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-1 px-4 py-6">
          <p className="text-[13.5px] font-medium text-ink">Your watchlist is empty.</p>
          <p className="text-[12.5px] text-muted">Add securities to monitor them here.</p>
          <Button size="sm" variant="secondary" className="mt-3" icon="sliders" onClick={onBrowse}>
            Browse the screener
          </Button>
        </div>
      ) : (
        <>
          <ul className="py-1">
            {shown.map(item => (
              <WatchRow key={item.symbol} symbol={item.symbol} />
            ))}
          </ul>
          <Link
            href="/watchlist"
            className={cn(
              'mt-auto flex h-9 items-center justify-between border-t border-line-subtle px-4 text-[11.5px] text-muted',
              'transition-colors duration-150 hover:text-ink',
            )}
          >
            <span>
              {items.length > PREVIEW_LIMIT
                ? `${items.length - PREVIEW_LIMIT} more in your watchlist`
                : 'Open the watchlist workspace'}
            </span>
            <span aria-hidden>→</span>
          </Link>
        </>
      )}
    </section>
  );
}
