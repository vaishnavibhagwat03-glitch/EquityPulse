import { create } from 'zustand';
import type { LiveQuote, Stock, Universe } from '@/types/market';
import type { QuoteTuple } from '@/lib/feed/protocol';
import { buildColumnStore, writeLiveRows, type ColumnStore } from '@/lib/filters/columnStore';
import { applyQuote } from '@/lib/stockFields';

/**
 * Universe + live quotes.
 *
 * Live quotes are the hot path: the feed delivers ~100+ updates a second. The
 * `quotes` Map is mutated in place and `quoteVersion` is bumped once per frame
 * batch. Each updated symbol gets a *new* LiveQuote object while untouched
 * symbols keep theirs, so a cell subscribed with `s => s.quotes.get(symbol)`
 * re-renders only when its own quote changed — a tick never re-renders the
 * grid, only the handful of cells whose price moved.
 */

export interface QuoteUpdate {
  symbol: string;
  price: number;
  volume: number;
  /** Feed timestamp (epoch ms). */
  ts: number;
  /** performance.now() when the message was received, for latency measurement. */
  rx: number;
}

export interface StockState {
  universe: Universe | null;
  stocks: Stock[];
  bySymbol: Map<string, Stock>;
  columns: ColumnStore | null;

  quotes: Map<string, LiveQuote>;
  quoteVersion: number;
  /** Symbols changed since the column store last absorbed live values. */
  dirty: Set<string>;

  setUniverse(universe: Universe): void;
  applySnapshot(quotes: readonly QuoteTuple[], ts: number): void;
  applyTicks(updates: Iterable<QuoteUpdate>): number;
  /** Writes live values for dirty symbols into the filter columns. */
  syncLiveColumns(): number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

function makeQuote(
  symbol: string,
  price: number,
  previousClose: number,
  dayHigh: number,
  dayLow: number,
  volume: number,
  direction: LiveQuote['direction'],
  ts: number,
  rx: number,
): LiveQuote {
  const change = round2(price - previousClose);
  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent: previousClose ? round2((change / previousClose) * 100) : 0,
    dayHigh,
    dayLow,
    volume,
    direction,
    ts,
    rx,
  };
}

export type StoredQuote = LiveQuote;

export const useStockStore = create<StockState>()((set, get) => ({
  universe: null,
  stocks: [],
  bySymbol: new Map(),
  columns: null,
  quotes: new Map(),
  quoteVersion: 0,
  dirty: new Set(),

  setUniverse(universe) {
    const current = get().universe;
    if (
      current &&
      current.meta.version === universe.meta.version &&
      current.stocks.length === universe.stocks.length
    ) {
      return;
    }
    const bySymbol = new Map(universe.stocks.map(s => [s.symbol, s]));
    const columns = buildColumnStore(universe.stocks, universe.meta.version);
    // Quotes that arrived before the universe are folded in on the next sync.
    const dirty = new Set(get().quotes.keys());
    set({ universe, stocks: universe.stocks, bySymbol, columns, dirty });
    get().syncLiveColumns();
  },

  applySnapshot(tuples, ts) {
    const { quotes, dirty } = get();
    const rx = performance.now();
    for (const [symbol, price, dayHigh, dayLow, volume, previousClose] of tuples) {
      // A resync is a correction, not a market move: no flash.
      quotes.set(
        symbol,
        makeQuote(symbol, price, previousClose, dayHigh, dayLow, volume, 0, ts, rx),
      );
      dirty.add(symbol);
    }
    set(s => ({ quoteVersion: s.quoteVersion + 1 }));
  },

  applyTicks(updates) {
    const { quotes, bySymbol, dirty } = get();
    let applied = 0;
    for (const u of updates) {
      const prev = quotes.get(u.symbol);
      const previousClose = prev?.previousClose ?? bySymbol.get(u.symbol)?.previousClose;
      if (previousClose === undefined) continue;
      const lastPrice = prev?.price ?? bySymbol.get(u.symbol)?.price ?? u.price;
      const direction: LiveQuote['direction'] =
        u.price > lastPrice ? 1 : u.price < lastPrice ? -1 : 0;
      quotes.set(
        u.symbol,
        makeQuote(
          u.symbol,
          u.price,
          previousClose,
          Math.max(prev?.dayHigh ?? u.price, u.price),
          Math.min(prev?.dayLow ?? u.price, u.price),
          u.volume,
          direction,
          u.ts,
          u.rx,
        ),
      );
      dirty.add(u.symbol);
      applied++;
    }
    if (applied) set(s => ({ quoteVersion: s.quoteVersion + 1 }));
    return applied;
  },

  syncLiveColumns() {
    const { columns, dirty, bySymbol, quotes } = get();
    if (!columns || dirty.size === 0) return 0;
    const live: Stock[] = [];
    for (const symbol of dirty) {
      const stock = bySymbol.get(symbol);
      const quote = quotes.get(symbol);
      if (stock && quote) live.push(applyQuote(stock, quote));
    }
    dirty.clear();
    return writeLiveRows(columns, live);
  },
}));

/** Live quote for one symbol; re-renders only when that symbol updates. */
export const useQuote = (symbol: string | null | undefined): StoredQuote | undefined =>
  useStockStore(s => (symbol ? s.quotes.get(symbol) : undefined));

export const useStock = (symbol: string | null | undefined): Stock | undefined =>
  useStockStore(s => (symbol ? s.bySymbol.get(symbol) : undefined));

/** Non-reactive read for event handlers and imperative code. */
export const getStock = (symbol: string): Stock | undefined =>
  useStockStore.getState().bySymbol.get(symbol);
export const getQuote = (symbol: string): StoredQuote | undefined =>
  useStockStore.getState().quotes.get(symbol);
