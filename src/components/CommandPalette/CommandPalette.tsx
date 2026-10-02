'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Preset } from '@/types/filters';
import type { Universe } from '@/types/market';
import { cn } from '@/lib/cn';
import { BUILT_IN_PRESETS } from '@/lib/filters/presets';
import { formatPercent, formatPrice } from '@/lib/format';
import { buildSearchIndex, fuzzyMatch, searchStocks, type SearchIndex } from '@/lib/search';
import { useModKey } from '@/hooks/useHotkeys';
import { useFilterStore } from '@/stores/filterStore';
import { useQuote, useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsWatched, useWatchlistStore } from '@/stores/watchlistStore';
import { Icon } from '@/components/ui/Icon';
import { Kbd } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/overlays';
import { COMMANDS, type Command } from './commands';

/**
 * Command palette (Ctrl/⌘ K or /). One keyboard surface over securities,
 * screens, navigation and actions. Searching 5,247 securities is a single pass
 * over a prebuilt index (~1 ms), so results update on every keystroke.
 */

type Item =
  | { kind: 'stock'; key: string; id: number }
  | { kind: 'preset'; key: string; preset: Preset }
  | { kind: 'command'; key: string; command: Command };

interface Section {
  title: string;
  items: Item[];
}

/** Built once per universe version and kept across palette openings. */
let cachedIndex: { version: string; index: SearchIndex } | null = null;

function searchIndexFor(universe: Universe): SearchIndex {
  if (cachedIndex?.version !== universe.meta.version) {
    cachedIndex = { version: universe.meta.version, index: buildSearchIndex(universe.stocks) };
  }
  return cachedIndex.index;
}

function useSearchIndex(): SearchIndex | null {
  const universe = useStockStore(s => s.universe);
  return useMemo(() => (universe ? searchIndexFor(universe) : null), [universe]);
}

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const setPalette = useUiStore(s => s.setPalette);
  const recent = useUiStore(s => s.recent);
  const savedPresets = useFilterStore(s => s.savedPresets);
  const stocks = useStockStore(s => s.stocks);
  const index = useSearchIndex();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const mod = useModKey();

  const close = useCallback(() => setPalette(false), [setPalette]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    const presets = [...BUILT_IN_PRESETS, ...savedPresets];
    const out: Section[] = [];
    if (!q) {
      const recentItems = recent
        .map(symbol => stocks.find(s => s.symbol === symbol))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map(s => ({ kind: 'stock' as const, key: `stock-${s.symbol}`, id: s.id }));
      if (recentItems.length) out.push({ title: 'Recent', items: recentItems });
      out.push({
        title: 'Screeners',
        items: presets.slice(0, 6).map(p => ({ kind: 'preset', key: `preset-${p.id}`, preset: p })),
      });
      out.push({
        title: 'Actions',
        items: COMMANDS.filter(
          c => c.group === 'Navigate' || c.id === 'toggle-filters' || c.id === 'help',
        ).map(c => ({
          kind: 'command',
          key: c.id,
          command: c,
        })),
      });
      return out;
    }
    const hits = index ? searchStocks(index, q, 8) : [];
    if (hits.length)
      out.push({
        title: 'Securities',
        items: hits.map(h => ({ kind: 'stock', key: `stock-${h.id}`, id: h.id })),
      });
    const presetHits = presets
      .map(p => ({
        p,
        s: Math.max(fuzzyMatch(p.name, q), fuzzyMatch(p.criteria.join(' '), q) > 1 ? 1 : 0),
      }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
    if (presetHits.length)
      out.push({
        title: 'Screeners',
        items: presetHits.map(({ p }) => ({ kind: 'preset', key: `preset-${p.id}`, preset: p })),
      });
    const commandHits = COMMANDS.map(c => ({
      c,
      s: Math.max(fuzzyMatch(c.label, q), c.keywords ? fuzzyMatch(c.keywords, q) * 0.9 : 0),
    }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    if (commandHits.length)
      out.push({
        title: 'Actions',
        items: commandHits.map(({ c }) => ({ kind: 'command', key: c.id, command: c })),
      });
    return out;
  }, [query, index, savedPresets, recent, stocks]);

  const flat = useMemo(() => sections.flatMap(s => s.items), [sections]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openStock = useCallback(
    (id: number) => {
      const s = useStockStore.getState().stocks[id];
      if (!s) return;
      close();
      router.push(`/${encodeURIComponent(s.symbol)}`);
    },
    [close, router],
  );

  const run = useCallback(
    (item: Item, modifier: 'none' | 'mod' | 'shift' = 'none') => {
      if (item.kind === 'stock') {
        const s = useStockStore.getState().stocks[item.id];
        if (!s) return;
        if (modifier === 'mod') {
          useWatchlistStore.getState().toggle(s.symbol);
          return;
        }
        if (modifier === 'shift') {
          useFilterStore.getState().screenSimilar(s);
          close();
          router.push('/screener');
          return;
        }
        openStock(item.id);
        return;
      }
      if (item.kind === 'preset') {
        useFilterStore.getState().applyPreset(item.preset);
        close();
        if (!pathname.startsWith('/screener')) router.push('/screener');
        return;
      }
      close();
      item.command.run({ router, pathname });
    },
    [close, openStock, pathname, router],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(a => (flat.length ? (a + 1) % flat.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(a => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (event.key === 'Home' && event.ctrlKey) {
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      setActive(flat.length - 1);
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      run(current, event.metaKey || event.ctrlKey ? 'mod' : event.shiftKey ? 'shift' : 'none');
    }
  };

  let position = -1;
  return (
    <Dialog
      open
      onClose={close}
      label="Command palette"
      placement="top"
      className="max-w-[640px] overflow-hidden"
      initialFocus={inputRef}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Icon name="search" size={16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => {
            // A new query starts at its top result.
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search securities, actions, or screeners…"
          className="h-12 flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.key}` : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
        />
        <Kbd>ESC</Kbd>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Results"
        className="max-h-[min(56vh,460px)] overflow-y-auto p-1.5"
      >
        {flat.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-sm text-ink">
              {index ? `No results for “${query}”.` : 'Loading the market universe…'}
            </p>
            <p className="mt-1 text-xs text-muted">
              Try a symbol like RELIANCE, a company name, or a sector.
            </p>
          </div>
        ) : (
          sections.map(section => (
            <div key={section.title} role="group" aria-label={section.title} className="pb-1">
              <p className="px-2.5 pt-2 pb-1.5 label-caps">{section.title}</p>
              {section.items.map(item => {
                position++;
                const i = position;
                const isActive = i === active;
                return (
                  <div
                    key={item.key}
                    id={`${listId}-${item.key}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onMouseMove={() => !isActive && setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5',
                      isActive ? 'bg-surface-active' : 'bg-transparent',
                    )}
                  >
                    {item.kind === 'stock' ? (
                      <StockResult id={item.id} />
                    ) : item.kind === 'preset' ? (
                      <>
                        <Icon name="sliders" size={14} className="shrink-0 text-muted" />
                        <span className="text-[13px] text-ink">{item.preset.name}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">
                          {item.preset.criteria.join(' · ')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon
                          name={commandIcon(item.command)}
                          size={14}
                          className="shrink-0 text-muted"
                        />
                        <span className="flex-1 text-[13px] text-ink">{item.command.label}</span>
                        {item.command.shortcut ? (
                          <span className="flex gap-0.5">
                            {item.command.shortcut.map(k => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex h-10 items-center gap-4 border-t border-line bg-bg-sunken px-4 text-[11px] text-muted">
        {current?.kind === 'stock' ? (
          <StockActions id={current.id} mod={mod} onRun={modifier => run(current, modifier)} />
        ) : (
          <>
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> select
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Kbd>?</Kbd> shortcuts
            </span>
          </>
        )}
      </div>
    </Dialog>
  );
}

function commandIcon(c: Command) {
  switch (c.group) {
    case 'Navigate':
      return 'arrow-right' as const;
    case 'Appearance':
      return 'sun' as const;
    case 'Market feed':
      return 'wifi' as const;
    case 'Diagnostics':
      return 'gauge' as const;
    case 'Help':
      return 'keyboard' as const;
    default:
      return 'sliders' as const;
  }
}

const StockResult = memo(function StockResult({ id }: { id: number }) {
  const stock = useStockStore(s => s.stocks[id]);
  const quote = useQuote(stock?.symbol);
  const watched = useIsWatched(stock?.symbol);
  if (!stock) return null;
  const price = quote?.price ?? stock.price;
  const change = quote?.changePercent ?? stock.changePercent;
  return (
    <>
      <span className="w-[92px] shrink-0 truncate num text-[12.5px] font-semibold text-ink">
        {stock.symbol}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
        {stock.name}
        {watched ? (
          <Icon name="star-filled" size={11} className="ml-1.5 inline text-warning" />
        ) : null}
      </span>
      <span className="shrink-0 num text-[11.5px] text-muted">
        {stock.exchange} · ₹{formatPrice(price)} ·{' '}
        <span className={change > 0 ? 'up' : change < 0 ? 'down' : undefined}>
          {formatPercent(change, { signed: true })}
        </span>
      </span>
    </>
  );
});

function StockActions({
  id,
  mod,
  onRun,
}: {
  id: number;
  mod: string;
  onRun: (m: 'none' | 'mod' | 'shift') => void;
}) {
  const symbol = useStockStore(s => s.stocks[id]?.symbol);
  const watched = useIsWatched(symbol);
  const action = (keys: string[], label: string, modifier: 'none' | 'mod' | 'shift') => (
    <button
      type="button"
      onClick={() => onRun(modifier)}
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium tracking-[0.06em] text-ink-2 uppercase hover:bg-surface-active"
    >
      {keys.map(k => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="ml-1">{label}</span>
    </button>
  );
  return (
    <>
      {action(['↵'], 'Open chart', 'none')}
      {action([mod, '↵'], watched ? 'Remove from watchlist' : 'Add to watchlist', 'mod')}
      {action(['⇧', '↵'], 'Screen similar stocks', 'shift')}
    </>
  );
}
