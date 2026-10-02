'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Stock } from '@/types/market';
import { cn } from '@/lib/cn';
import {
  formatCompact,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatPrice,
  formatTime,
} from '@/lib/format';
import { useLiveStock } from '@/hooks/useLiveStock';
import { useFeedStore } from '@/stores/feedStore';
import { useFilterStore } from '@/stores/filterStore';
import { useQuote } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsWatched, useWatchlistStore } from '@/stores/watchlistStore';
import { Button } from '@/components/ui/Button';
import { Badge, ChangeText, StatusDot } from '@/components/ui/primitives';
import { RangeBar } from '@/components/ui/RangeBar';

/** Identity, live price and the stats a reader checks first. */
export function StockHeader({ initial }: { initial: Stock }) {
  const router = useRouter();
  const stock = useLiveStock(initial.symbol, initial) ?? initial;
  const quote = useQuote(initial.symbol);
  const feed = useFeedStore(s => s.status);
  const watched = useIsWatched(stock.symbol);
  const toggleWatch = useWatchlistStore(s => s.toggle);
  const screenSimilar = useFilterStore(s => s.screenSimilar);
  const setValue = useFilterStore(s => s.setValue);
  const clearAll = useFilterStore(s => s.clearAll);
  const pushRecent = useUiStore(s => s.pushRecent);

  useEffect(() => pushRecent(initial.symbol), [initial.symbol, pushRecent]);

  const openSector = (): void => {
    clearAll();
    setValue('sector', { type: 'multiselect', values: [stock.sector] });
    router.push('/screener');
  };

  const stats = [
    { label: 'Market cap', value: formatMarketCap(stock.marketCap) },
    { label: 'P/E', value: stock.pe === null ? 'n/m' : formatNumber(stock.pe, 1) },
    { label: 'P/B', value: formatNumber(stock.pb, 2) },
    { label: 'ROE', value: formatPercent(stock.roe, { decimals: 1 }) },
    { label: 'Div yield', value: formatPercent(stock.dividendYield) },
    {
      label: 'Volume',
      value: (
        <>
          {formatCompact(stock.volume)}
          <span className="ml-1 text-[11px] text-muted">
            {formatNumber(stock.relativeVolume, 1)}× avg
          </span>
        </>
      ),
    },
  ];

  return (
    <header className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Link href="/" className="hover:text-ink">
          Markets
        </Link>
        <span aria-hidden>/</span>
        <Link href="/screener" className="hover:text-ink">
          Screener
        </Link>
        <span aria-hidden>/</span>
        <button
          type="button"
          onClick={openSector}
          className="hover:text-ink"
          title={`Screen all of ${stock.sector}`}
        >
          {stock.sector}
        </button>
        <span aria-hidden>/</span>
        <span className="num text-ink-2" aria-current="page">
          {stock.symbol}
        </span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(22px,2.6vw,30px)] leading-tight font-semibold tracking-[-0.015em] text-ink">
            {stock.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="num font-semibold tracking-[0.02em] text-ink">{stock.symbol}</span>
            <Badge tone="outline">{stock.exchange}</Badge>
            <span>{stock.industry}</span>
            <span aria-hidden>·</span>
            <span>{stock.marketCapCategory}</span>
            {stock.isin ? (
              <>
                <span aria-hidden>·</span>
                <span className="num">ISIN {stock.isin}</span>
              </>
            ) : null}
          </div>
          {stock.indices.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {stock.indices.map(i => (
                <Badge key={i} tone="neutral">
                  {i}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-baseline gap-3">
            <span className="num text-[clamp(28px,3vw,36px)] leading-none font-medium tracking-[-0.02em] text-ink">
              ₹{formatPrice(stock.price)}
            </span>
            <span className="flex items-baseline gap-1.5 text-[14px]">
              <ChangeText value={stock.change} percent={false} />
              <ChangeText value={stock.changePercent} />
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">
            <StatusDot tone={feed === 'live' ? 'live' : feed === 'offline' ? 'off' : 'warn'} />
            {feed === 'live' ? 'Live' : feed === 'offline' ? 'Offline · last price' : 'Connecting'}
            {quote ? (
              <span className="num tracking-normal normal-case">· {formatTime(quote.ts)} IST</span>
            ) : null}
            <span className="tracking-normal normal-case">
              · prev close ₹{formatPrice(stock.previousClose)}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={watched ? 'subtle' : 'primary'}
              icon={watched ? 'star-filled' : 'star'}
              onClick={() => toggleWatch(stock.symbol)}
              aria-pressed={watched}
              className={cn(watched && '[&_svg]:text-warning')}
            >
              {watched ? 'Watching' : 'Add to watchlist'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="sliders"
              onClick={() => {
                screenSimilar(stock);
                router.push('/screener');
              }}
            >
              Screen similar
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-3 border-y border-line py-3 md:grid-cols-[1fr_minmax(260px,0.9fr)]">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-6">
          {stats.map(s => (
            <div key={s.label}>
              <dt className="label-caps">{s.label}</dt>
              <dd className="mt-0.5 num text-[13px] whitespace-nowrap text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 label-caps">Day</span>
            <RangeBar
              low={stock.dayLow}
              high={stock.dayHigh}
              value={stock.price}
              label="Day range"
              className="flex-1"
              compact
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 label-caps">52 week</span>
            <RangeBar
              low={stock.week52Low}
              high={stock.week52High}
              value={stock.price}
              label="52-week range"
              className="flex-1"
              compact
            />
          </div>
        </div>
      </div>
    </header>
  );
}
