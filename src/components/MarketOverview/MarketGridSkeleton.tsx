import { Skeleton } from '@/components/ui/primitives';

/**
 * The market grid's structure before its data: same hairline cells, same
 * proportions, so nothing shifts when the figures arrive.
 */
export function MarketGridSkeleton() {
  return (
    <div className="flex flex-col pb-12" aria-busy="true" aria-label="Loading market overview">
      <div className="flex flex-col items-center gap-4 px-4 pt-[clamp(28px,5.5vh,60px)] pb-[clamp(24px,4.5vh,44px)]">
        <Skeleton className="h-3 w-72" />
        <Skeleton className="h-[clamp(38px,5vw,62px)] w-[min(80vw,560px)]" />
        <Skeleton className="h-[clamp(38px,5vw,62px)] w-[min(70vw,480px)]" />
        <Skeleton className="mt-2 h-4 w-[min(80vw,460px)]" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-36" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-6">
        <div className="grid grid-cols-12 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <div className="col-span-12 h-9 bg-bg" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="col-span-6 flex flex-col gap-3 bg-surface p-4 xl:col-span-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="col-span-6 flex h-[60px] items-center bg-surface px-4 lg:col-span-3"
            >
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
          <div className="col-span-12 h-9 bg-bg" />
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="col-span-12 flex h-[380px] flex-col gap-3 bg-surface p-4 md:col-span-6 lg:col-span-4"
            >
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-full w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
