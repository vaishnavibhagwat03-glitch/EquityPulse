'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { CATEGORY_ORDER } from '@/lib/filters/definitions';
import { countActiveFilters } from '@/lib/filters/panel';
import { formatInteger } from '@/lib/format';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useIsDesktop, useIsMobile, useIsWide } from '@/hooks/useMediaQuery';
import { useStockScreener } from '@/hooks/useStockScreener';
import { resolvePendingTransition } from '@/lib/transitions';
import { useFeedStore } from '@/stores/feedStore';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ColumnPicker } from '@/components/DataGrid/ColumnPicker';
import { DataGrid } from '@/components/DataGrid/DataGrid';
import { GridEmpty, GridSkeleton } from '@/components/DataGrid/GridStates';
import { ActiveFilterChips } from '@/components/FilterPanel/ActiveFilterChips';
import { FilterPanel, FilterRail } from '@/components/FilterPanel/FilterPanel';
import { PresetBar } from '@/components/FilterPanel/PresetBar';
import { ContextPanel } from '@/components/StockDetail/ContextPanel';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/controls';
import { Drawer } from '@/components/ui/overlays';
import { StatusDot } from '@/components/ui/primitives';

/**
 * The screener: filter panel (left), result grid (centre), selected-security
 * context (right). All query state is in stores, so leaving and returning —
 * or opening a stock and pressing Back — restores the exact screen.
 */

const MOBILE_COLUMNS = { symbol: true, price: true, changePercent: true, marketCap: true };

export function ScreenerWorkspace() {
  const router = useRouter();
  const result = useStockScreener();
  const stocks = useStockStore(s => s.stocks);
  const sort = useFilterStore(s => s.sort);
  const cycleSort = useFilterStore(s => s.cycleSort);
  const search = useFilterStore(s => s.search);
  const setSearch = useFilterStore(s => s.setSearch);
  const clearAll = useFilterStore(s => s.clearAll);
  const watchlistOnly = useFilterStore(s => s.watchlistOnly);
  const activeFilters = useFilterStore(s => countActiveFilters(s.panel));
  const filtersCollapsed = useUiStore(s => s.filtersCollapsed);
  const toggleFilters = useUiStore(s => s.toggleFilters);
  const contextOpen = useUiStore(s => s.contextOpen);
  const toggleContext = useUiStore(s => s.toggleContext);
  const mobileFiltersOpen = useUiStore(s => s.mobileFiltersOpen);
  const setMobileFilters = useUiStore(s => s.setMobileFilters);
  const selected = useUiStore(s => s.selectedSymbol);
  const select = useUiStore(s => s.select);
  const columns = useUiStore(s => s.columns);
  const setColumns = useUiStore(s => s.setColumns);
  const toggleWatch = useWatchlistStore(s => s.toggle);
  const feedStatus = useFeedStore(s => s.status);
  const isDesktop = useIsDesktop();
  const isWide = useIsWide();
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLElement>(null);

  // The Market → Screener view transition waits for this page's first frame.
  // Arriving from the market grid, columns and rows also stagger in ("rows
  // multiply") — for the first second only, so rows that scroll into the
  // virtual window later never animate.
  useLayoutEffect(() => {
    const el = gridRef.current;
    const at = useUiStore.getState().enteredFromMarket;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (el && at !== null && Date.now() - at < 1500) {
      el.dataset.entering = '';
      timer = setTimeout(() => delete el.dataset.entering, 1100);
    }
    resolvePendingTransition();
    return () => clearTimeout(timer);
  }, []);

  const onOpen = useCallback(
    (symbol: string) => router.push(`/${encodeURIComponent(symbol)}`),
    [router],
  );
  const onToggleWatch = useCallback((symbol: string) => toggleWatch(symbol), [toggleWatch]);
  const onLayoutChange = useCallback(
    (layout: Parameters<React.ComponentProps<typeof DataGrid>['onLayoutChange']>[0]) =>
      setColumns(prev => ({
        visibility: layout.visibility ?? prev.visibility,
        pinning: layout.pinning
          ? { left: layout.pinning.left ?? [], right: layout.pinning.right ?? [] }
          : prev.pinning,
        sizing: layout.sizing ?? prev.sizing,
      })),
    [setColumns],
  );

  // Keep the context panel populated: default to the first result.
  const firstSymbol = result.rows.length ? (stocks[result.rows[0]!]?.symbol ?? null) : null;
  useEffect(() => {
    if (!selected && firstSymbol && isWide) select(firstSymbol);
  }, [selected, firstSymbol, isWide, select]);

  useHotkeys({
    f: () => (isDesktop ? toggleFilters() : setMobileFilters(!mobileFiltersOpen)),
    s: () => searchRef.current?.focus(),
  });

  const panel = (onCollapse?: () => void) => (
    <ErrorBoundary
      region="Filter panel"
      title="Filters temporarily unavailable."
      description="Your current screen is still applied."
    >
      <FilterPanel stats={result.stats} expression={result.expression} onCollapse={onCollapse}>
        <FilterPanel.Header />
        <FilterPanel.Search />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {CATEGORY_ORDER.map(category => (
            <FilterPanel.Group key={category} category={category} />
          ))}
          <FilterPanel.Custom />
        </div>
        <FilterPanel.Footer />
      </FilterPanel>
    </ErrorBoundary>
  );

  const total = result.stats.total || stocks.length;
  const matched = result.ready ? result.stats.matched : 0;
  const pinning = useMemo(
    () => ({ left: columns.pinning.left, right: columns.pinning.right }),
    [columns.pinning],
  );

  return (
    <div
      className="flex min-h-0 flex-1"
      style={{ height: 'calc(100dvh - var(--nav-height) - var(--status-height))' }}
    >
      {/* Which layout applies is decided by CSS (lg = the desktop breakpoint),
          so the server-rendered HTML is already right on a phone and nothing
          moves when the page hydrates. Script only decides what mounts inside. */}
      <div
        className={cn(
          'hidden shrink-0 border-r border-line lg:block',
          filtersCollapsed ? 'w-12' : 'w-[320px]',
        )}
        style={{ viewTransitionName: 'filter-panel', transition: 'width 220ms var(--ep-ease-out)' }}
      >
        {!isDesktop ? null : filtersCollapsed ? (
          <FilterRail onExpand={() => toggleFilters(false)} />
        ) : (
          panel(() => toggleFilters(true))
        )}
      </div>
      {!isDesktop ? (
        <Drawer open={mobileFiltersOpen} onClose={() => setMobileFilters(false)} label="Filters">
          {panel(() => setMobileFilters(false))}
        </Drawer>
      ) : null}

      <section
        ref={gridRef}
        aria-labelledby="screener-title"
        className="flex min-w-0 flex-1 flex-col"
        style={{ viewTransitionName: 'market-grid' }}
      >
        <header className="shrink-0 space-y-3 border-b border-line bg-bg px-4 pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-3">
              <h1
                id="screener-title"
                className="text-[20px] font-semibold tracking-[-0.01em] text-ink"
              >
                Screener
              </h1>
              <p className="num text-[12px] text-muted" aria-live="polite">
                {result.ready ? (
                  <>
                    <span className="text-ink">{formatInteger(matched)}</span> of{' '}
                    {formatInteger(total)} securities
                  </>
                ) : (
                  'Loading universe…'
                )}
              </p>
            </div>
            <span className="hidden items-center gap-1.5 md:flex">
              <StatusDot
                tone={feedStatus === 'live' ? 'live' : feedStatus === 'offline' ? 'off' : 'warn'}
              />
              <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">
                {feedStatus === 'live'
                  ? 'Market simulation live'
                  : feedStatus === 'offline'
                    ? 'Feed offline · showing last prices'
                    : 'Connecting feed'}
              </span>
              {result.liveFilter ? (
                <span
                  className="text-[10.5px] tracking-[0.04em] text-faint"
                  title="This screen uses live fields; membership refreshes every 2 seconds"
                >
                  · re-screening live
                </span>
              ) : null}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="contents lg:hidden">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="sliders"
                  onClick={() => setMobileFilters(true)}
                >
                  Filters{activeFilters ? ` · ${activeFilters}` : ''}
                </Button>
              </span>
              <SearchInput
                ref={searchRef}
                value={search}
                onValueChange={setSearch}
                placeholder="Search stocks, symbols, sectors…"
                aria-label="Search stocks, symbols, sectors"
                shortcut="S"
                containerClassName="w-[min(48vw,280px)]"
              />
              <span className="hidden md:contents">
                <ColumnPicker />
              </span>
              {!contextOpen ? (
                <span className="hidden xl:contents">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="panel-right"
                    onClick={() => toggleContext(true)}
                  >
                    Details
                  </Button>
                </span>
              ) : null}
            </div>
          </div>
          <PresetBar />
          <ActiveFilterChips />
        </header>

        <div className="relative min-h-0 flex-1">
          <ErrorBoundary
            region="Results grid"
            title="Results temporarily unavailable."
            description="Your filters are intact. Retry to rebuild the grid."
            resetKeys={[result.rows]}
          >
            {!result.ready ? (
              <GridSkeleton />
            ) : result.rows.length === 0 ? (
              <GridEmpty onClear={clearAll} watchlistOnly={watchlistOnly} />
            ) : (
              <DataGrid
                stocks={stocks}
                rows={result.rows}
                sort={sort}
                onSort={cycleSort}
                activeSymbol={selected}
                onActivate={select}
                onOpen={onOpen}
                onToggleWatch={onToggleWatch}
                columnVisibility={columns.visibility}
                columnPinning={pinning}
                columnSizing={columns.sizing}
                onLayoutChange={onLayoutChange}
                forcedVisibility={isMobile ? MOBILE_COLUMNS : undefined}
                label={`Screener results: ${formatInteger(matched)} securities`}
              />
            )}
          </ErrorBoundary>
        </div>
      </section>

      {contextOpen ? (
        <div className="hidden w-[340px] shrink-0 border-l border-line xl:block">
          {isWide ? <ContextPanel symbol={selected} onClose={() => toggleContext(false)} /> : null}
        </div>
      ) : null}
    </div>
  );
}
