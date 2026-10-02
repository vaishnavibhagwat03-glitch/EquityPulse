'use client';

import { useMemo, useRef, useState } from 'react';
import type { Candle } from '@/types/market';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatPercent, formatPrice } from '@/lib/format';
import { Skeleton } from '@/components/ui/primitives';

/**
 * Lightweight SVG close-price chart for compact surfaces (context panel,
 * watchlist). One series, so no legend; a hairline marks the period's first
 * close; hover shows a crosshair with date and close.
 */
export function MiniChart({
  candles,
  height = 96,
  className,
  label,
  livePrice,
}: {
  candles: readonly Candle[] | undefined;
  height?: number;
  className?: string;
  label: string;
  livePrice?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 320;
  const pad = { top: 6, right: 4, bottom: 6, left: 4 };

  const series = useMemo(() => {
    if (!candles?.length) return null;
    const closes = candles.map(c => c.close);
    if (livePrice !== undefined) closes[closes.length - 1] = livePrice;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of closes) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const x = (i: number): number =>
      pad.left + (i / (closes.length - 1)) * (width - pad.left - pad.right);
    const y = (v: number): number =>
      pad.top + (1 - (v - lo) / span) * (height - pad.top - pad.bottom);
    const line = closes
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
    const area = `${line}L${x(closes.length - 1).toFixed(1)},${height - pad.bottom}L${x(0).toFixed(1)},${height - pad.bottom}Z`;
    return { closes, x, y, line, area, first: closes[0]!, last: closes[closes.length - 1]! };
  }, [candles, height, livePrice, pad.bottom, pad.left, pad.right, pad.top]);

  if (!series || !candles)
    return <Skeleton className={cn('w-full', className)} style={{ height }} />;

  const change = (series.last / series.first - 1) * 100;
  const up = change >= 0;
  const onMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const t = (event.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(1, Math.max(0, t)) * (series.closes.length - 1)));
  };
  const hi = hover !== null ? hover : null;

  return (
    <figure className={cn('relative', className)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-auto w-full"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${label}: ${formatPercent(change, { signed: true })} over the period`}
      >
        <line
          x1={0}
          x2={width}
          y1={series.y(series.first)}
          y2={series.y(series.first)}
          stroke="var(--chart-grid)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path d={series.area} fill="var(--text)" opacity={0.045} />
        <path
          d={series.line}
          fill="none"
          stroke="var(--text-2)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={series.x(series.closes.length - 1)}
          cy={series.y(series.last)}
          r={3}
          fill={up ? 'var(--positive)' : 'var(--negative)'}
          stroke="var(--surface)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {hi !== null ? (
          <>
            <line
              x1={series.x(hi)}
              x2={series.x(hi)}
              y1={0}
              y2={height}
              stroke="var(--border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={series.x(hi)}
              cy={series.y(series.closes[hi]!)}
              r={3}
              fill="var(--text)"
              stroke="var(--surface)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>
      {hi !== null && candles[hi] ? (
        <figcaption
          className="pointer-events-none absolute top-0 rounded-sm border border-line bg-surface px-1.5 py-0.5 num text-[10.5px] text-ink shadow-sm"
          style={{
            left: `clamp(0px, calc(${(series.x(hi) / width) * 100}% - 40px), calc(100% - 96px))`,
          }}
        >
          {formatDayMonth(candles[hi]!.time * 1000)} · ₹{formatPrice(series.closes[hi])}
        </figcaption>
      ) : null}
    </figure>
  );
}
