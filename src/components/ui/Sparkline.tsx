import { memo } from 'react';
import { cn } from '@/lib/cn';
import { sparklinePoints } from '@/lib/sparkline';

/**
 * Inline trend line. The line itself is de-emphasised; only the latest point
 * carries direction colour, so a column of sparklines reads as shape first and
 * stays calm at 5,000 rows.
 */
export const Sparkline = memo(function Sparkline({
  values,
  width = 64,
  height = 20,
  tone,
  label,
  className,
  strokeWidth = 1.25,
  area = false,
}: {
  /** Normalised 0–1 values. */
  values: readonly number[];
  width?: number;
  height?: number;
  tone?: 'up' | 'down' | 'flat';
  label?: string;
  className?: string;
  strokeWidth?: number;
  area?: boolean;
}) {
  if (values.length < 2)
    return <span style={{ width, height }} className="inline-block" aria-hidden />;
  const pad = 2.5;
  const points = sparklinePoints(values, width, height, pad);
  const lastX = width - pad;
  const lastY = pad + (1 - values[values.length - 1]!) * (height - pad * 2);
  const dotColor =
    tone === 'up' ? 'var(--positive)' : tone === 'down' ? 'var(--negative)' : 'var(--text-muted)';
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block shrink-0 overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {area ? (
        <polygon
          points={`${pad},${height - pad} ${points} ${lastX},${height - pad}`}
          fill="var(--text-muted)"
          opacity={0.07}
        />
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke="var(--text-muted)"
        strokeOpacity={0.75}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={2.25}
        fill={dotColor}
        stroke="var(--surface)"
        strokeWidth={1.25}
      />
    </svg>
  );
});
