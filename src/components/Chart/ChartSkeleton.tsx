import { Skeleton } from '@/components/ui/primitives';

/** Structural chart placeholder: gridlines and a quiet candle silhouette. */
export function ChartSkeleton({ height = 460 }: { height?: number }) {
  const bars = Array.from({ length: 56 }, (_, i) => {
    const wave = Math.sin(i / 5) * 0.18 + Math.sin(i / 2.3) * 0.06;
    return { top: 0.32 - wave + (i % 7) * 0.008, size: 0.1 + ((i * 7) % 5) * 0.025 };
  });
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height }}
      aria-busy="true"
      aria-label="Loading chart"
    >
      {[0.2, 0.4, 0.6].map(y => (
        <span
          key={y}
          className="absolute right-0 left-0 h-px bg-line-subtle"
          style={{ top: `${y * 100}%` }}
        />
      ))}
      <div className="absolute inset-x-3 top-[8%] h-[62%]">
        {bars.map((b, i) => (
          <Skeleton
            key={i}
            className="absolute w-[1.1%] rounded-[1px]"
            style={{
              left: `${(i / bars.length) * 100}%`,
              top: `${b.top * 100}%`,
              height: `${b.size * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="absolute inset-x-3 bottom-[4%] flex h-[14%] items-end gap-[0.45%]">
        {bars.map((b, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-[1px]"
            style={{ height: `${30 + ((i * 13) % 60)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
