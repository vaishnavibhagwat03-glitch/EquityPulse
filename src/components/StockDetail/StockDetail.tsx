'use client';

import dynamic from 'next/dynamic';
import type { Fundamentals, Stock } from '@/types/market';
import type { Peer } from '@/lib/api';
import { useUiStore } from '@/stores/uiStore';
import { ErrorBoundary, RegionFallback } from '@/components/ErrorBoundary';
import { ChartSkeleton } from '@/components/Chart/ChartSkeleton';
import { FundamentalsTabs } from './FundamentalsTabs';
import { PeersTable } from './PeersTable';
import { StockHeader } from './StockHeader';

// Code-split: Lightweight Charts loads only when a stock page is opened.
const StockChart = dynamic(() => import('@/components/Chart/StockChart'), {
  ssr: false,
  loading: () => (
    <div className="border-b border-line">
      <div className="h-[45px] border-b border-line" />
      <ChartSkeleton height={460} />
    </div>
  ),
});

export function StockDetail({
  initial,
  peers,
  fundamentals,
}: {
  initial: Stock;
  peers: Peer[];
  fundamentals: Fundamentals;
}) {
  const setChartFault = useUiStore(s => s.setChartFault);
  return (
    <div className="page-enter mx-auto w-full max-w-[1440px] px-4 pt-5 pb-12 sm:px-6">
      <StockHeader initial={initial} />
      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <ErrorBoundary
              region="Chart"
              resetKeys={[initial.symbol]}
              onReset={() => setChartFault(false)}
              fallback={({ reset }) => (
                <RegionFallback
                  title="Chart temporarily unavailable."
                  description="Prices, fundamentals and the rest of the page are unaffected."
                  onRetry={reset}
                  className="min-h-[505px]"
                />
              )}
            >
              <StockChart symbol={initial.symbol} />
            </ErrorBoundary>
          </div>
          <FundamentalsTabs initial={initial} fundamentals={fundamentals} />
        </div>
        <aside className="space-y-8 xl:pt-0">
          <PeersTable peers={peers} industry={initial.industry} />
        </aside>
      </div>
    </div>
  );
}
