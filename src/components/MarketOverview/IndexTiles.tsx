'use client';

import { memo } from 'react';
import type { MarketOverview } from '@/types/market';
import type { FeedStatus } from '@/stores/feedStore';
import { cn } from '@/lib/cn';
import { direction, formatInteger, formatNumber, formatPercent, formatSigned } from '@/lib/format';
import { normalise } from '@/lib/sparkline';
import { useIndexTrail } from '@/hooks/useLiveOverview';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ChangeText, StatusDot } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/Sparkline';
import { emergeStyle } from './emerge';

export type IndexRow = MarketOverview['indices'][number];

/** 09:15–15:30 in five-minute bars: the x-axis is the whole session. */
const SESSION_BARS = 75;

const formatLevel = (v: number): string => formatNumber(v, 2);

const STATUS: Record<FeedStatus, { tone: 'live' | 'warn' | 'off' | 'idle'; text: string }> = {
  idle: { tone: 'idle', text: 'Snapshot' },
  connecting: { tone: 'warn', text: 'Syncing' },
  live: { tone: 'live', text: 'Live' },
  reconnecting: { tone: 'warn', text: 'Reconnecting' },
  offline: { tone: 'off', text: 'Last' },
};

/**
 * Intraday path against the previous close. The line takes the day's
 * direction; the dashed baseline is yesterday's close, so "above / below the
 * line" reads at a glance. Scales to its container (non-scaling strokes).
 */
export function IntradayLine({
  values,
  previousClose,
  height = 44,
  label,
}: {
  values: readonly number[];
  previousClose: number;
  height?: number;
  label: string;
}) {
  if (values.length < 2) return <div style={{ height }} aria-hidden />;
  const w = 300;
  let lo = previousClose;
  let hi = previousClose;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = (hi - lo) * 0.1 || previousClose * 0.002;
  const y = (v: number): number => 2 + ((hi + pad - v) / (hi - lo + pad * 2)) * (height - 4);
  const span = Math.max(SESSION_BARS, values.length - 1);
  const x = (i: number): number => (i / span) * w;
  let line = '';
  values.forEach((v, i) => {
    line += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const base = y(previousClose);
  const lastX = x(values.length - 1);
  const last = values[values.length - 1]!;
  const up = last >= previousClose;
  const stroke = up ? 'var(--positive)' : 'var(--negative)';
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="block w-full overflow-visible"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <path
        d={`${line}L${lastX.toFixed(1)},${base.toFixed(1)}L0,${base.toFixed(1)}Z`}
        fill={up ? 'var(--positive-soft)' : 'var(--negative-soft)'}
      />
      <line
        x1={0}
        x2={w}
        y1={base}
        y2={base}
        stroke="var(--border-strong)"
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* A zero-length round-capped stroke stays a circle under non-uniform scaling. */}
      <path
        d={`M${lastX.toFixed(1)},${y(last).toFixed(1)}l0,0`}
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export const IndexTile = memo(function IndexTile({
  index,
  status,
  emerge,
}: {
  index: IndexRow;
  status: FeedStatus;
  emerge: number;
}) {
  const trail = useIndexTrail(index.id, index.intraday);
  const state = STATUS[status];
  const high = Math.max(index.dayHigh, index.value);
  const low = Math.min(index.dayLow, index.value);
  const dir = direction(index.change);
  return (
    <article
      data-emerge
      style={emergeStyle(emerge)}
      aria-label={`${index.name}: ${formatLevel(index.value)}, ${formatPercent(index.changePercent, { signed: true })}`}
      className="col-span-6 flex min-w-0 flex-col gap-2 bg-surface px-3 pt-3 pb-2.5 sm:px-4 xl:col-span-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="truncate text-[11.5px] font-semibold tracking-[0.08em] text-ink uppercase">
          {index.name}
        </h3>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium tracking-[0.08em] text-muted uppercase">
          <StatusDot tone={state.tone} />
          <span className="hidden sm:inline">{index.exchange} · </span>
          {state.text}
        </span>
      </header>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <AnimatedNumber
          value={index.value}
          format={formatLevel}
          className="text-[clamp(17px,1.9vw,23px)] leading-none font-medium tracking-[-0.02em] text-ink"
        />
        <span
          className={cn(
            'num text-[12px] whitespace-nowrap',
            dir > 0 ? 'up' : dir < 0 ? 'down' : 'text-muted',
          )}
        >
          <span className="hidden sm:inline">{formatSigned(index.change)} </span>
          {formatPercent(index.changePercent, { signed: true })}
        </span>
      </div>
      <IntradayLine
        values={trail}
        previousClose={index.previousClose}
        label={`${index.name} intraday, ${formatPercent(index.changePercent, { signed: true })} against the previous close`}
      />
      <footer className="hidden justify-between num text-[10.5px] text-faint sm:flex">
        <span>
          H {formatLevel(high)} · L {formatLevel(low)}
        </span>
        <span>
          <span className="up">{formatInteger(index.advancing)}▲</span>{' '}
          <span className="down">{formatInteger(index.declining)}▼</span>
        </span>
      </footer>
    </article>
  );
});

/** Secondary indices: one line each, with a 60-session trend. */
export const IndexStripCell = memo(function IndexStripCell({
  index,
  emerge,
}: {
  index: IndexRow;
  emerge: number;
}) {
  const dir = direction(index.changePercent);
  const values =
    index.history.length > 1 ? normalise([...index.history.slice(-40), index.value]) : [];
  return (
    <div
      data-emerge
      style={emergeStyle(emerge)}
      className="col-span-6 flex min-w-0 items-center gap-3 bg-surface px-3 py-2.5 sm:px-4 lg:col-span-3"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
          {index.short}
        </span>
        <span className="flex items-baseline gap-2">
          <AnimatedNumber
            value={index.value}
            format={formatLevel}
            className="text-[13px] text-ink"
          />
          <ChangeText value={index.changePercent} className="text-[11.5px]" />
        </span>
      </span>
      <Sparkline
        values={values}
        width={56}
        height={22}
        tone={dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}
        label={`${index.name}, last 40 sessions`}
        className="hidden sm:block"
      />
    </div>
  );
});
