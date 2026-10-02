import { ChartSkeleton } from '@/components/Chart/ChartSkeleton';
import { Skeleton } from '@/components/ui/primitives';

/** Stock detail skeleton: the page's own structure while the server renders. */
export default function LoadingStock() {
  return (
    <div
      className="mx-auto w-full max-w-[1440px] px-4 pt-5 pb-12 sm:px-6"
      aria-busy="true"
      aria-label="Loading security"
    >
      <Skeleton className="h-3 w-56" />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-3">
          <Skeleton className="h-7 w-80" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-6 border-y border-line py-3 sm:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-2 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="h-[45px] border-b border-line" />
        <ChartSkeleton height={460} />
      </div>
    </div>
  );
}
