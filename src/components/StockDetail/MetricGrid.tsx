import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: string;
}

/** Definition-list grid of label/value pairs, hairline-separated, no cards. */
export function MetricGrid({
  metrics,
  columns = 2,
  className,
}: {
  metrics: readonly Metric[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-2 sm:grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {metrics.map(m => (
        <div
          key={m.label}
          className="flex items-baseline justify-between gap-3 border-b border-line-subtle py-[7px]"
          title={m.hint}
        >
          <dt className="truncate text-[12px] text-muted">{m.label}</dt>
          <dd className="shrink-0 num text-[12.5px] text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}
