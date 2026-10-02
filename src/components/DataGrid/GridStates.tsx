import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/primitives';

const WIDTHS = [236, 76, 96, 86, 92, 116, 64, 64, 60, 86, 98, 98];

/** Structural loading state: the grid's own geometry, not a spinner. */
export function GridSkeleton({ rows = 18 }: { rows?: number }) {
  return (
    <div
      className="h-full overflow-hidden bg-surface"
      aria-busy="true"
      aria-label="Loading securities"
    >
      <div className="flex h-[34px] items-center border-b border-line">
        {WIDTHS.map((w, i) => (
          <div key={i} className="shrink-0 px-2.5" style={{ width: w }}>
            <Skeleton className="h-2 w-10" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-[34px] items-center border-b border-line-subtle">
          {WIDTHS.map((w, i) => (
            <div
              key={i}
              className="flex shrink-0 px-2.5"
              style={{ width: w, justifyContent: i < 2 ? 'flex-start' : 'flex-end' }}
            >
              <Skeleton
                className="h-2.5"
                style={{
                  width:
                    i === 0 ? 64 + ((r * 37) % 90) : i === 1 ? 52 : 30 + ((r * 13 + i * 7) % 26),
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function GridEmpty({
  onClear,
  watchlistOnly,
}: {
  onClear: () => void;
  watchlistOnly?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 bg-surface px-6 text-center">
      <p className="font-display text-[26px] leading-tight text-ink">
        No stocks match your filters.
      </p>
      <p className="mt-1 text-[12.5px] text-muted">
        {watchlistOnly
          ? 'Your watchlist has no securities that pass this screen.'
          : 'Try removing one or more conditions.'}
      </p>
      <Button variant="primary" size="md" className="mt-4" onClick={onClear}>
        CLEAR FILTERS
      </Button>
    </div>
  );
}
