import { cn } from '@/lib/cn';
import { formatPrice } from '@/lib/format';

/**
 * Where a value sits within a low–high range (day range, 52-week range).
 * A hairline track with one marker; the ends are labelled in text tokens.
 */
export function RangeBar({
  low,
  high,
  value,
  label,
  showLabels = true,
  className,
  compact = false,
}: {
  low: number;
  high: number;
  value: number;
  label: string;
  showLabels?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const span = high - low;
  const t = span > 0 ? Math.min(1, Math.max(0, (value - low) / span)) : 0.5;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showLabels ? (
        <span className="w-[68px] shrink-0 text-right num text-xs text-muted">
          {formatPrice(low)}
        </span>
      ) : null}
      <div
        className={cn('relative flex-1', compact ? 'h-3' : 'h-4')}
        role="meter"
        aria-label={label}
        aria-valuemin={low}
        aria-valuemax={high}
        aria-valuenow={value}
        aria-valuetext={`${formatPrice(value)} within ${formatPrice(low)} to ${formatPrice(high)}`}
      >
        <span className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-line-strong" />
        <span
          className="absolute top-1/2 h-[9px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-ink"
          style={{ left: `${t * 100}%` }}
        />
      </div>
      {showLabels ? (
        <span className="w-[68px] shrink-0 num text-xs text-muted">{formatPrice(high)}</span>
      ) : null}
    </div>
  );
}
