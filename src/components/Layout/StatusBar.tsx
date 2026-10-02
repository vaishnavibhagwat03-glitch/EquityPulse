'use client';

import { cn } from '@/lib/cn';
import { formatInteger } from '@/lib/format';
import { useFeedStore } from '@/stores/feedStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Terminal-style status strip. Every figure is live state, not a label: feed
 * transport and throughput, round-trip, universe size and the disclosure that
 * the data is simulated.
 */
export function StatusBar() {
  const transport = useFeedStore(s => s.transport);
  const status = useFeedStore(s => s.status);
  const tps = useFeedStore(s => s.ticksPerSecond);
  const rtt = useFeedStore(s => s.rttMs);
  const size = useStockStore(s => s.stocks.length);
  const version = useStockStore(s => s.universe?.meta.asOf ?? null);
  const perfOpen = useUiStore(s => s.perfOpen);
  const setPerf = useUiStore(s => s.setPerf);

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur-sm"
      style={{ height: 'var(--status-height)' }}
    >
      <div className="flex h-full items-center gap-4 overflow-hidden px-3 num text-[10.5px] tracking-[0.04em] text-muted sm:px-4">
        <span className="shrink-0 text-ink-2">SIMULATED MARKET DATA</span>
        <span className="hidden shrink-0 md:inline">NOT INVESTMENT ADVICE</span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          UNIVERSE {size ? formatInteger(size) : '—'}
          {version ? ` · AS OF ${version}` : ''}
        </span>
        <span className="hidden shrink-0 lg:inline">
          FEED {transport === 'ws' ? 'WS' : transport === 'worker' ? 'WORKER' : '—'}
          {status === 'live' ? ` · ${formatInteger(tps)} UPD/S` : ''}
          {status === 'live' && rtt !== null ? ` · RTT ${rtt} MS` : ''}
        </span>
        <button
          type="button"
          onClick={() => setPerf(!perfOpen)}
          aria-pressed={perfOpen}
          className={cn(
            'ml-auto shrink-0 rounded-sm px-1.5 py-0.5 transition-colors duration-150 sm:ml-0',
            perfOpen ? 'bg-surface-active text-ink' : 'hover:bg-surface-active hover:text-ink',
          )}
        >
          PERF
        </button>
      </div>
    </footer>
  );
}
