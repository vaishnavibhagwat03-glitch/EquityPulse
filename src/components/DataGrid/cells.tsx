'use client';

import { memo, useLayoutEffect, useRef } from 'react';
import type { LiveQuote, Stock } from '@/types/market';
import { cn } from '@/lib/cn';
import { MACD_LABELS } from '@/lib/filters/definitions';
import {
  DASH,
  formatCompact,
  formatInteger,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSigned,
} from '@/lib/format';
import { recordTickLatency } from '@/lib/performance';
import { decodeSparkline } from '@/lib/sparkline';
import { peFor } from '@/lib/stockFields';
import { useQuote } from '@/stores/stockStore';
import { useIsWatched } from '@/stores/watchlistStore';
import { Icon } from '@/components/ui/Icon';
import { Sparkline } from '@/components/ui/Sparkline';

/**
 * Grid cell renderers.
 *
 * Static cells render from the snapshot record and only re-render when their
 * row does. Live cells subscribe to one symbol's quote; when it changes, only
 * that cell re-renders and flashes. The flash is a Web Animations API
 * background fade on the value itself — no overlay element, no extra layer,
 * no React state — and is skipped entirely under reduced motion.
 *
 * Cells are kept to as few elements as possible: the grid repaints the rows
 * in view while it scrolls, so every element per row is paid for per frame.
 */

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Flashes once per new quote object with a non-zero direction. */
function useTickFlash(quote: LiveQuote | undefined) {
  const flashRef = useRef<HTMLSpanElement>(null);
  const seen = useRef<LiveQuote | undefined>(quote);
  useLayoutEffect(() => {
    if (!quote || quote === seen.current) return;
    seen.current = quote;
    if (quote.rx) recordTickLatency(quote.rx);
    if (quote.direction === 0 || reducedMotion()) return;
    const el = flashRef.current;
    // A cosmetic flash must never be able to take the grid down.
    if (!el || typeof el.animate !== 'function') return;
    const tint = quote.direction > 0 ? 'var(--positive-flash)' : 'var(--negative-flash)';
    el.animate(
      [
        { backgroundColor: 'transparent' },
        { backgroundColor: tint, offset: 0.1 },
        { backgroundColor: 'transparent' },
      ],
      {
        duration: 720,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
    );
  }, [quote]);
  return flashRef;
}

/** The value pill a live cell flashes behind. */
const LIVE_VALUE = 'num -mx-1.5 rounded-[3px] px-1.5 py-[3px] text-[12.5px]';

const tone = (v: number | null | undefined): string | undefined =>
  v === null || v === undefined || Math.abs(v) < 1e-9 ? 'text-muted' : v > 0 ? 'up' : 'down';

/* ------------------------------------------------------------------ live */

export const PriceCell = memo(function PriceCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const flash = useTickFlash(q);
  return (
    <span ref={flash} className={cn(LIVE_VALUE, 'font-medium text-ink')}>
      {formatPrice(q?.price ?? stock.price)}
    </span>
  );
});

export const ChangeCell = memo(function ChangeCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const flash = useTickFlash(q);
  const pct = q?.changePercent ?? stock.changePercent;
  return (
    <span ref={flash} className={cn(LIVE_VALUE, tone(pct))}>
      {formatPercent(pct, { signed: true })}
    </span>
  );
});

export const ChangeAbsCell = memo(function ChangeAbsCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const chg = q?.change ?? stock.change;
  return <span className={cn('num text-[12.5px]', tone(chg))}>{formatSigned(chg)}</span>;
});

export const VolumeCell = memo(function VolumeCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const v = q?.volume ?? stock.volume;
  return (
    <span className="num text-[12.5px] text-ink-2" title={`${formatInteger(v)} shares`}>
      {formatCompact(v, 2)}
    </span>
  );
});

export const MarketCapCell = memo(function MarketCapCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const cap = q ? Math.round(stock.sharesOutstanding * q.price) : stock.marketCap;
  return <span className="num text-[12.5px] text-ink-2">{formatInteger(cap)}</span>;
});

export const PeCell = memo(function PeCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const pe = q ? peFor(q.price, stock.eps) : stock.pe;
  return (
    <span
      className={cn('num text-[12.5px]', pe === null ? 'text-faint' : 'text-ink-2')}
      title={pe === null ? 'Loss-making: P/E not meaningful' : undefined}
    >
      {pe === null ? 'n/m' : formatNumber(pe, 1)}
    </span>
  );
});

/** Day range with the live price marked. */
export const DayRangeCell = memo(function DayRangeCell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const low = q?.dayLow ?? stock.dayLow;
  const high = q?.dayHigh ?? stock.dayHigh;
  const price = q?.price ?? stock.price;
  return <MiniRange low={low} high={high} value={price} label="Day range" />;
});

export const Week52Cell = memo(function Week52Cell({ stock }: { stock: Stock }) {
  const q = useQuote(stock.symbol);
  const price = q?.price ?? stock.price;
  return (
    <MiniRange
      low={Math.min(stock.week52Low, q?.dayLow ?? Infinity)}
      high={Math.max(stock.week52High, q?.dayHigh ?? -Infinity)}
      value={price}
      label="52-week range"
    />
  );
});

function MiniRange({
  low,
  high,
  value,
  label,
}: {
  low: number;
  high: number;
  value: number;
  label: string;
}) {
  const t = high > low ? Math.min(1, Math.max(0, (value - low) / (high - low))) : 0.5;
  return (
    <span
      className="relative block h-3 w-full"
      role="meter"
      aria-label={label}
      aria-valuemin={low}
      aria-valuemax={high}
      aria-valuenow={value}
      title={`${label}: ${formatPrice(low)} – ${formatPrice(high)}`}
    >
      <span className="absolute top-1/2 right-0 left-0 h-px bg-line-strong" />
      <span
        className="absolute top-1/2 h-2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-ink-2"
        style={{ left: `${t * 100}%` }}
      />
    </span>
  );
}

/* ---------------------------------------------------------------- static */

export const SymbolCell = memo(function SymbolCell({ stock }: { stock: Stock }) {
  const watched = useIsWatched(stock.symbol);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-[86px] shrink-0 truncate num text-[12.5px] font-semibold tracking-[0.01em] text-ink">
        {stock.symbol}
      </span>
      <span className="min-w-0 truncate text-[12px] text-muted">{stock.name}</span>
      {watched ? (
        <Icon
          name="star-filled"
          size={10}
          className="shrink-0 text-warning"
          aria-label="In watchlist"
        />
      ) : null}
    </span>
  );
});

export const SparkCell = memo(function SparkCell({ stock }: { stock: Stock }) {
  const values = decodeSparkline(stock.spark);
  const t = stock.return1M > 0.05 ? 'up' : stock.return1M < -0.05 ? 'down' : 'flat';
  return (
    <Sparkline
      values={values}
      width={60}
      height={18}
      tone={t}
      label={`One-month trend ${formatPercent(stock.return1M, { signed: true })}`}
    />
  );
});

export function NumberCell({
  value,
  decimals = 2,
  suffix = '',
  className,
}: {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return <span className="num text-[12.5px] text-faint">{DASH}</span>;
  return (
    <span className={cn('num text-[12.5px] text-ink-2', className)}>
      {formatNumber(value, decimals)}
      {suffix}
    </span>
  );
}

export function SignedPercentCell({ value }: { value: number | null | undefined }) {
  return (
    <span className={cn('num text-[12.5px]', tone(value))}>
      {formatPercent(value, { signed: true, decimals: 1 })}
    </span>
  );
}

/** RSI with a hairline 0–100 track; 30/70 zones carry meaning, not decoration. */
export const RsiCell = memo(function RsiCell({ stock }: { stock: Stock }) {
  const v = stock.rsi14;
  const zone = v >= 70 ? 'Overbought' : v <= 30 ? 'Oversold' : null;
  return (
    <span
      className="flex w-full items-center justify-end gap-2"
      title={zone ? `${zone} (RSI ${v.toFixed(1)})` : undefined}
    >
      {/* Track and 30 / 70 ticks are one element's backgrounds; only the marker is a child. */}
      <span className="rsi-track relative hidden h-2.5 w-7 shrink-0 xl:block" aria-hidden>
        <span
          className={cn(
            'absolute top-1/2 h-2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px]',
            zone === 'Overbought'
              ? 'bg-negative'
              : zone === 'Oversold'
                ? 'bg-positive'
                : 'bg-ink-2',
          )}
          style={{ left: `${Math.min(100, Math.max(0, v))}%` }}
        />
      </span>
      <span className={cn('num text-[12.5px]', zone ? 'font-medium text-ink' : 'text-ink-2')}>
        {v.toFixed(1)}
      </span>
    </span>
  );
});

/** Moving average value with a marker for where the live price sits relative to it. */
export const MovingAverageCell = memo(function MovingAverageCell({
  stock,
  field,
}: {
  stock: Stock;
  field: 'sma50' | 'sma200' | 'sma20' | 'ema12' | 'ema26';
}) {
  const q = useQuote(stock.symbol);
  const price = q?.price ?? stock.price;
  const ma = stock[field];
  const above = price >= ma;
  return (
    <span
      className="num text-[12.5px] text-ink-2"
      title={`Price ${above ? 'above' : 'below'} ${field.toUpperCase()}`}
    >
      <span
        className={cn('mr-1.5 align-[1px] text-[8px] leading-none', above ? 'up' : 'down')}
        aria-hidden
      >
        {above ? '▲' : '▼'}
      </span>
      {formatPrice(ma)}
      <span className="sr-only">{above ? ' price above' : ' price below'}</span>
    </span>
  );
});

export function TextCell({ value, muted = false }: { value: string; muted?: boolean }) {
  return (
    <span className={cn('truncate text-[12px]', muted ? 'text-muted' : 'text-ink-2')}>{value}</span>
  );
}

export function MacdCell({ stock }: { stock: Stock }) {
  const s = stock.macdState;
  const cls = s.startsWith('BULLISH') ? 'up' : s.startsWith('BEARISH') ? 'down' : 'text-muted';
  return <span className={cn('truncate text-[12px]', cls)}>{MACD_LABELS[s] ?? s}</span>;
}
