'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Stock } from '@/types/market';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatInteger, formatPercent } from '@/lib/format';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore, type WatchItem } from '@/stores/watchlistStore';
import {
  ChangeCell,
  DayRangeCell,
  MarketCapCell,
  PeCell,
  PriceCell,
  RsiCell,
  SparkCell,
  VolumeCell,
  Week52Cell,
} from '@/components/DataGrid/cells';
import { Button, IconButton } from '@/components/ui/Button';
import { Label, Skeleton } from '@/components/ui/primitives';

/**
 * Watchlist: a monitoring workspace, not a dashboard. One dense live table,
 * an aggregate line above it, keyboard navigation (↑ ↓, Enter to open,
 * Delete to remove) and persistence in this browser.
 */

type SortKey = 'added' | 'symbol' | 'change' | 'marketCap';

const SUGGESTED = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL'];

export function WatchlistWorkspace() {
  const router = useRouter();
  const items = useWatchlistStore(s => s.items);
  const remove = useWatchlistStore(s => s.remove);
  const add = useWatchlistStore(s => s.add);
  const bySymbol = useStockStore(s => s.bySymbol);
  const ready = useStockStore(s => s.stocks.length > 0);
  const quotesVersion = useStockStore(s => s.quoteVersion);
  const setPalette = useUiStore(s => s.setPalette);
  const setWatchlistOnly = useFilterStore(s => s.setWatchlistOnly);
  const [sort, setSort] = useState<SortKey>('added');
  const [active, setActive] = useState(0);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const rows = useMemo(() => {
    const list = items
      .map(item => ({ item, stock: bySymbol.get(item.symbol) }))
      .filter((r): r is { item: WatchItem; stock: Stock } => Boolean(r.stock));
    const q = useStockStore.getState().quotes;
    const change = (s: Stock): number => q.get(s.symbol)?.changePercent ?? s.changePercent;
    switch (sort) {
      case 'symbol':
        return list.sort((a, b) => a.stock.symbol.localeCompare(b.stock.symbol));
      case 'change':
        return list.sort((a, b) => change(b.stock) - change(a.stock));
      case 'marketCap':
        return list.sort((a, b) => b.stock.marketCap - a.stock.marketCap);
      default:
        return list;
    }
    // Re-sort by live change only when the user asks (sort change), not per tick.
  }, [items, bySymbol, sort]);

  const pulse = useMemo(() => {
    const q = useStockStore.getState().quotes;
    let adv = 0;
    let dec = 0;
    let sum = 0;
    for (const { stock } of rows) {
      const c = q.get(stock.symbol)?.changePercent ?? stock.changePercent;
      sum += c;
      if (c > 0.05) adv++;
      else if (c < -0.05) dec++;
    }
    return { adv, dec, avg: rows.length ? sum / rows.length : 0 };
    // quotesVersion keeps the aggregate line live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, quotesVersion]);

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>): void => {
    const row = rows[active];
    if (event.key === 'ArrowDown') setActive(a => Math.min(rows.length - 1, a + 1));
    else if (event.key === 'ArrowUp') setActive(a => Math.max(0, a - 1));
    else if (event.key === 'Enter' && row) router.push(`/${encodeURIComponent(row.stock.symbol)}`);
    else if ((event.key === 'Delete' || event.key === 'Backspace') && row) remove(row.stock.symbol);
    else return;
    event.preventDefault();
  };

  if (!ready && items.length) {
    return (
      <Shell>
        <div className="space-y-2">
          {items.map(i => (
            <Skeleton key={i.symbol} className="h-9 w-full" />
          ))}
        </div>
      </Shell>
    );
  }

  if (!rows.length) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-surface px-6 py-20 text-center">
          <p className="font-display text-[30px] leading-tight text-ink">
            Your watchlist is empty.
          </p>
          <p className="mt-2 text-[13px] text-muted">Add securities to monitor them here.</p>
          <div className="mt-6 flex gap-2">
            <Button variant="primary" icon="search" onClick={() => setPalette(true)}>
              Search securities
            </Button>
            <Link
              href="/screener"
              className="inline-flex h-8 press items-center rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:border-line-strong"
            >
              Open screener
            </Link>
          </div>
          <div className="mt-8">
            <Label>Start with</Label>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {SUGGESTED.filter(s => bySymbol.has(s)).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="h-7 press rounded-md border border-line bg-surface px-2.5 num text-[11.5px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      aria-pressed={sort === key}
      className={cn(
        'rounded-sm px-1.5 py-0.5',
        sort === key ? 'bg-surface-active text-ink' : 'text-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );

  return (
    <Shell
      actions={
        <>
          <Button
            size="sm"
            variant="secondary"
            icon="sliders"
            onClick={() => {
              setWatchlistOnly(true);
              router.push('/screener');
            }}
          >
            Screen watchlist
          </Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => setPalette(true)}>
            Add security
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="num text-[12px] text-muted" aria-live="polite">
          <span className="text-ink">{rows.length}</span> securities · avg{' '}
          <span className={pulse.avg >= 0 ? 'up' : 'down'}>
            {formatPercent(pulse.avg, { signed: true })}
          </span>{' '}
          · {pulse.adv} up · {pulse.dec} down
        </p>
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <span className="mr-1 label-caps">Sort</span>
          {sortButton('added', 'Recently added')}
          {sortButton('change', 'Change')}
          {sortButton('marketCap', 'Market cap')}
          {sortButton('symbol', 'A–Z')}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[1080px] border-collapse">
          <caption className="sr-only">
            Watchlist with live prices. Arrow keys move, Enter opens, Delete removes.
          </caption>
          <thead>
            <tr className="h-[34px] border-b border-line text-[10.5px] tracking-[0.07em] text-muted uppercase">
              <th scope="col" className="px-3 text-left font-medium">
                Security
              </th>
              <th scope="col" className="px-2 text-left font-medium">
                1M
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                LTP
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                Change
              </th>
              <th scope="col" className="w-[110px] px-3 text-left font-medium">
                Day range
              </th>
              <th scope="col" className="w-[110px] px-3 text-left font-medium">
                52W range
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                Volume
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                Mkt cap ₹Cr
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                P/E
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                RSI
              </th>
              <th scope="col" className="px-2 text-right font-medium">
                Added
              </th>
              <th scope="col" className="w-10 px-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody
            ref={tableRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="outline-none focus-visible:[&>tr[data-active=true]]:shadow-[inset_2px_0_0_var(--accent)]"
          >
            {rows.map(({ item, stock }, i) => (
              <WatchRow
                key={stock.symbol}
                stock={stock}
                item={item}
                active={i === active}
                onSelect={() => setActive(i)}
                onRemove={() => remove(stock.symbol)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Saved in this browser. Prices are simulated and update live.
      </p>
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const count = useWatchlistStore(s => s.items.length);
  return (
    <div className="page-enter mx-auto w-full max-w-[1440px] px-4 pt-6 pb-12 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Watchlist</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            {count
              ? `${formatInteger(count)} securities monitored`
              : 'Monitor the securities that matter to you.'}
          </p>
        </div>
        <div className="flex gap-2">{actions}</div>
      </header>
      {children}
    </div>
  );
}

const WatchRow = memo(function WatchRow({
  stock,
  item,
  active,
  onSelect,
  onRemove,
}: {
  stock: Stock;
  item: WatchItem;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  return (
    <tr
      data-active={active}
      onClick={onSelect}
      onDoubleClick={() => router.push(`/${encodeURIComponent(stock.symbol)}`)}
      className={cn(
        'h-[42px] border-b border-line-subtle',
        active ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      <th scope="row" className="px-3 text-left font-normal">
        <Link href={`/${encodeURIComponent(stock.symbol)}`} className="group block">
          <span className="block num text-[12.5px] font-semibold text-ink group-hover:underline">
            {stock.symbol}
          </span>
          <span className="block max-w-[220px] truncate text-[11px] text-muted">{stock.name}</span>
        </Link>
      </th>
      <td className="px-2">
        <SparkCell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <PriceCell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <ChangeCell stock={stock} />
      </td>
      <td className="px-3">
        <DayRangeCell stock={stock} />
      </td>
      <td className="px-3">
        <Week52Cell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <VolumeCell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <MarketCapCell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <PeCell stock={stock} />
      </td>
      <td className="px-2 text-right">
        <RsiCell stock={stock} />
      </td>
      <td className="px-2 text-right num text-[11.5px] text-muted">
        {formatDayMonth(item.addedAt)}
      </td>
      <td className="px-2 text-right">
        <IconButton
          icon="x"
          size="xs"
          label={`Remove ${stock.symbol} from watchlist`}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        />
      </td>
    </tr>
  );
});
