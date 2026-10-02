'use client';

import { useCallback } from 'react';
import type { MarketOverview } from '@/types/market';
import { formatTime } from '@/lib/format';
import { useLiveOverview } from '@/hooks/useLiveOverview';
import { useOpenScreener } from '@/hooks/useOpenScreener';
import { useFeedStore, type FeedStatus } from '@/stores/feedStore';
import { useFilterStore } from '@/stores/filterStore';
import { BootSequence } from '@/components/Boot/BootSequence';
import type { BootInput } from '@/components/Boot/bootInput';
import { MarketClock } from '@/components/Layout/MarketClock';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/primitives';
import { emergeStyle } from './emerge';
import { Headline } from './Headline';
import { IndexStripCell, IndexTile } from './IndexTiles';
import { ScreenCells } from './ScreenCells';
import { SectionHead } from './SectionHead';
import { BreadthCell, SectorMovement, TopMovers } from './SignalCells';
import { Spotlight, WatchPreview } from './WorkspaceCells';

/**
 * The home page: a masthead and the Market Grid — one hairline-ruled surface
 * that compresses the whole market (indices, breadth, sectors, movers), then
 * leads into the product (screens, analysis, watchlist).
 *
 * It renders complete from the server snapshot, then every figure goes live
 * as the feed connects. On a first visit the boot sequence plays over it and
 * hands over to it (see components/Boot).
 */

const PRIMARY = ['NIFTY50', 'SENSEX', 'BANKNIFTY', 'NIFTYIT'];

const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

const FEED_LABEL: Record<FeedStatus, { tone: 'live' | 'warn' | 'off' | 'idle'; text: string }> = {
  idle: { tone: 'idle', text: 'Connecting feed' },
  connecting: { tone: 'warn', text: 'Connecting feed' },
  live: { tone: 'live', text: 'Simulated session live' },
  reconnecting: { tone: 'warn', text: 'Reconnecting' },
  offline: { tone: 'off', text: 'Feed offline · last prices' },
};

function Separator() {
  return (
    <span aria-hidden className="text-line-strong">
      /
    </span>
  );
}

function Masthead({
  asOf,
  status,
  onOpenScreener,
  onExplore,
}: {
  asOf: number;
  status: FeedStatus;
  onOpenScreener: () => void;
  onExplore: () => void;
}) {
  const feed = FEED_LABEL[status];
  return (
    <section
      aria-labelledby="home-headline"
      className="px-4 pt-[clamp(28px,5.5vh,60px)] pb-[clamp(24px,4.5vh,44px)] text-center"
    >
      <p
        data-emerge
        style={emergeStyle(0)}
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 num text-[10.5px] tracking-[0.14em] text-muted uppercase"
      >
        <span>{longDate.format(asOf)}</span>
        <Separator />
        <span>NSE · BSE</span>
        <Separator />
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={feed.tone} />
          {feed.text}
        </span>
        <Separator />
        <MarketClock className="inline-flex items-baseline text-ink-2" />
      </p>
      <Headline id="home-headline" data-hero-headline="" className="mt-5" />
      <p
        data-emerge
        style={emergeStyle(1)}
        className="mx-auto mt-4 max-w-[54ch] text-[14px] leading-[22px] text-ink-2"
      >
        Screen 5,000+ NSE &amp; BSE securities using fundamental and technical signals.
      </p>
      <div data-emerge style={emergeStyle(2)} className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="lg" iconRight="arrow-right" onClick={onOpenScreener}>
          Open screener
        </Button>
        <Button variant="secondary" size="lg" onClick={onExplore}>
          Explore markets
        </Button>
      </div>
    </section>
  );
}

export function MarketHome({ snapshot, boot }: { snapshot: MarketOverview; boot: BootInput }) {
  const overview = useLiveOverview(snapshot);
  const status = useFeedStore(s => s.status);
  const openScreener = useOpenScreener();

  const openAll = useCallback(() => openScreener(), [openScreener]);
  const openSector = useCallback(
    (name: string) =>
      openScreener(() => {
        const filters = useFilterStore.getState();
        filters.clearAll();
        filters.setValue('sector', { type: 'multiselect', values: [name] });
      }),
    [openScreener],
  );
  const explore = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById('signal')
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const byId = new Map(overview.indices.map(i => [i.id, i]));
  const primary = PRIMARY.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const secondary = overview.indices.filter(i => !PRIMARY.includes(i.id)).slice(0, 4);

  return (
    <>
      <BootSequence {...boot} />
      <div className="flex flex-col pb-12">
        <Masthead
          asOf={snapshot.asOf}
          status={status}
          onOpenScreener={openAll}
          onExplore={explore}
        />

        <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-6">
          <div
            className="grid grid-cols-12 gap-px overflow-hidden rounded-lg border border-line bg-line"
            style={{ viewTransitionName: 'market-grid' }}
          >
            <SectionHead step="01" title="Market" emerge={3} className="col-span-12">
              <span className="truncate">
                <span className="hidden sm:inline">Indices · </span>updated{' '}
                {formatTime(overview.asOf)} IST
              </span>
            </SectionHead>
            {primary.map((index, i) => (
              <IndexTile key={index.id} index={index} status={status} emerge={4 + i} />
            ))}
            {secondary.map((index, i) => (
              <IndexStripCell key={index.id} index={index} emerge={8 + i} />
            ))}

            <SectionHead
              step="02"
              title="Signal"
              anchor="signal"
              emerge={10}
              className="col-span-12 scroll-mt-[calc(var(--nav-height)+16px)]"
            >
              <span className="hidden sm:inline">Breadth · sectors · movers</span>
            </SectionHead>
            <BreadthCell
              breadth={overview.breadth}
              distribution={overview.distribution}
              emerge={11}
            />
            <SectorMovement sectors={overview.sectors} onOpenSector={openSector} emerge={12} />
            <TopMovers movers={overview.movers} emerge={13} />

            <SectionHead step="03" title="Screen" emerge={14} className="col-span-12">
              <button
                type="button"
                onClick={openAll}
                className="tracking-[0.04em] transition-colors duration-150 hover:text-ink"
              >
                Open screener →
              </button>
            </SectionHead>
            <ScreenCells onOpen={openScreener} firstEmerge={15} />

            <Spotlight
              fallbackSymbol={snapshot.movers.active[0]?.symbol ?? 'RELIANCE'}
              emerge={18}
            />
            <WatchPreview onBrowse={openAll} emerge={19} />
          </div>
        </div>
      </div>
    </>
  );
}
