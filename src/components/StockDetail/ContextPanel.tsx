'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { BB_ZONE_LABELS, MACD_LABELS } from '@/lib/filters/definitions';
import {
  DASH,
  formatCompact,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatPrice,
} from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useHistory } from '@/hooks/useHistory';
import { useLiveStock } from '@/hooks/useLiveStock';
import { useFilterStore } from '@/stores/filterStore';
import { useIsWatched, useWatchlistStore } from '@/stores/watchlistStore';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, ChangeText, Label } from '@/components/ui/primitives';
import { RangeBar } from '@/components/ui/RangeBar';
import { MetricGrid } from './MetricGrid';
import { MiniChart } from './MiniChart';

/**
 * Screener context panel: the selected security at a glance, live. Progressive
 * disclosure — the full analysis is one click (or Enter) away.
 */
export function ContextPanel({ symbol, onClose }: { symbol: string | null; onClose?: () => void }) {
  const router = useRouter();
  const stock = useLiveStock(symbol);
  const chartSymbol = useDebouncedValue(symbol, 180);
  const history = useHistory(chartSymbol, '1d');
  const watched = useIsWatched(symbol);
  const toggleWatch = useWatchlistStore(s => s.toggle);
  const screenSimilar = useFilterStore(s => s.screenSimilar);

  if (!stock) {
    return (
      <aside
        aria-label="Selected security"
        className="flex h-full flex-col items-center justify-center gap-2 bg-surface px-8 text-center"
      >
        <p className="text-sm text-ink">Select a security</p>
        <p className="text-xs leading-5 text-muted">
          Click a row, or use ↑ ↓ in the grid. Enter opens the full analysis.
        </p>
      </aside>
    );
  }

  const candles = history.data?.data.candles.slice(-66);
  const metrics = [
    { label: 'Mkt cap', value: formatMarketCap(stock.marketCap) },
    {
      label: 'P/E',
      value: stock.pe === null ? 'n/m' : formatNumber(stock.pe, 1),
      hint: 'Price / trailing EPS at the live price',
    },
    { label: 'P/B', value: formatNumber(stock.pb, 2) },
    { label: 'ROE', value: formatPercent(stock.roe, { decimals: 1 }) },
    { label: 'ROCE', value: formatPercent(stock.roce, { decimals: 1 }) },
    {
      label: 'D/E',
      value: stock.debtToEquity === null ? 'n/a' : formatNumber(stock.debtToEquity, 2),
    },
    { label: 'Div yield', value: formatPercent(stock.dividendYield) },
    { label: 'EPS', value: `₹${formatPrice(stock.eps)}` },
    { label: 'Rev growth', value: <ChangeText value={stock.revenueGrowth} decimals={1} /> },
    { label: 'Profit gr.', value: <ChangeText value={stock.profitGrowth} decimals={1} /> },
    { label: 'Promoter', value: formatPercent(stock.promoterHolding, { decimals: 1 }) },
    { label: 'Beta', value: formatNumber(stock.beta, 2) },
  ];

  return (
    <aside
      aria-label={`${stock.symbol} summary`}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="num text-[15px] font-semibold tracking-[0.01em] text-ink">
                {stock.symbol}
              </h2>
              <Badge tone="outline">{stock.exchange}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-2">{stock.name}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted">
              {stock.sector} · {stock.industry}
            </p>
          </div>
          <IconButton
            icon={watched ? 'star-filled' : 'star'}
            label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            active={watched}
            className={watched ? 'text-warning hover:text-warning' : undefined}
            onClick={() => toggleWatch(stock.symbol)}
          />
          {onClose ? <IconButton icon="panel-right" label="Hide panel" onClick={onClose} /> : null}
        </div>

        <div className="mt-4 flex items-baseline gap-3">
          <span className="num text-[26px] leading-none font-medium tracking-[-0.02em] text-ink">
            ₹{formatPrice(stock.price)}
          </span>
          <span className="flex items-baseline gap-1.5 text-[12.5px]">
            <ChangeText value={stock.change} percent={false} />
            <ChangeText value={stock.changePercent} className="text-[12.5px]" />
          </span>
        </div>
        <p className="mt-1 num text-[10.5px] text-muted">
          VOL {formatCompact(stock.volume)} · {formatNumber(stock.relativeVolume, 2)}× AVG
        </p>

        <div className="mt-4 space-y-2">
          <div>
            <Label>Day range</Label>
            <RangeBar
              low={stock.dayLow}
              high={stock.dayHigh}
              value={stock.price}
              label="Day range"
              className="mt-1"
              compact
            />
          </div>
          <div>
            <Label>52-week range</Label>
            <RangeBar
              low={stock.week52Low}
              high={stock.week52High}
              value={stock.price}
              label="52-week range"
              className="mt-1"
              compact
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <Label>3 months</Label>
            {candles?.length ? (
              <ChangeText
                value={(stock.price / candles[0]!.close - 1) * 100}
                className="text-[11px]"
              />
            ) : null}
          </div>
          <MiniChart
            candles={candles}
            livePrice={stock.price}
            label={`${stock.symbol} three-month closing prices`}
            height={92}
          />
        </div>

        <div className="mt-5">
          <Label as="h3">Key metrics</Label>
          <MetricGrid metrics={metrics} className="mt-1" />
        </div>

        <div className="mt-5">
          <Label as="h3">Technicals</Label>
          <MetricGrid
            className="mt-1"
            columns={1}
            metrics={[
              {
                label: 'RSI (14)',
                value: (
                  <span
                    className={cn(
                      stock.rsi14 >= 70 || stock.rsi14 <= 30 ? 'font-semibold' : undefined,
                    )}
                  >
                    {formatNumber(stock.rsi14, 1)}
                  </span>
                ),
              },
              { label: 'MACD', value: MACD_LABELS[stock.macdState] ?? DASH },
              { label: 'Bollinger', value: BB_ZONE_LABELS[stock.bbZone] ?? DASH },
              { label: 'SMA 50 / 200', value: stock.trendState === 'GOLDEN' ? 'Golden' : 'Death' },
              { label: 'vs SMA 50', value: <ChangeText value={stock.priceVsSma50} decimals={1} /> },
              {
                label: 'vs SMA 200',
                value: <ChangeText value={stock.priceVsSma200} decimals={1} />,
              },
            ]}
          />
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-line p-3">
        <Link
          href={`/${encodeURIComponent(stock.symbol)}`}
          className="inline-flex h-8 flex-1 press items-center justify-center gap-1.5 rounded-md bg-surface-inverse text-[12.5px] font-medium text-ink-inverse hover:opacity-90"
        >
          Open full analysis
        </Link>
        <Button
          variant="secondary"
          onClick={() => {
            screenSimilar(stock);
            router.push('/screener');
          }}
        >
          Similar
        </Button>
      </div>
    </aside>
  );
}
