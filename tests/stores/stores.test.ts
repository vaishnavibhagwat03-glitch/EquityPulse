import { beforeEach, describe, expect, it } from 'vitest';
import { toUniverse } from '@/lib/mockDataGenerator';
import { PRESET_BY_ID } from '@/lib/filters/presets';
import { DEFAULT_SORT, useFilterStore } from '@/stores/filterStore';
import { useFeedStore } from '@/stores/feedStore';
import { useStockStore } from '@/stores/stockStore';
import { DEFAULT_COLUMNS, useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { market } from '../fixtures/market';

const universe = toUniverse(market(40));
const [first, second] = universe.stocks;

function resetStockStore(): void {
  useStockStore.setState({
    universe: null,
    stocks: [],
    bySymbol: new Map(),
    columns: null,
    quotes: new Map(),
    quoteVersion: 0,
    dirty: new Set(),
  });
}

describe('stock store', () => {
  beforeEach(resetStockStore);

  it('indexes the universe and builds filter columns once per version', () => {
    useStockStore.getState().setUniverse(universe);
    const { stocks, bySymbol, columns } = useStockStore.getState();
    expect(stocks).toHaveLength(40);
    expect(bySymbol.get(first!.symbol)).toBe(first);
    expect(columns!.size).toBe(40);
    useStockStore.getState().setUniverse({ ...universe });
    expect(useStockStore.getState().columns).toBe(columns); // same version: no rebuild
  });

  it('applies a snapshot without flashing (direction 0)', () => {
    useStockStore.getState().setUniverse(universe);
    useStockStore.getState().applySnapshot([[first!.symbol, 101, 102, 99, 5000, 100]], 1);
    const q = useStockStore.getState().quotes.get(first!.symbol)!;
    expect(q).toMatchObject({ price: 101, change: 1, changePercent: 1, direction: 0 });
  });

  it('applies ticks with direction, day range and a new object per changed symbol only', () => {
    useStockStore.getState().setUniverse(universe);
    useStockStore.getState().applySnapshot(
      [
        [first!.symbol, 100, 100, 100, 1, 100],
        [second!.symbol, 50, 50, 50, 1, 50],
      ],
      1,
    );
    const untouched = useStockStore.getState().quotes.get(second!.symbol);
    const version = useStockStore.getState().quoteVersion;
    const applied = useStockStore.getState().applyTicks([
      { symbol: first!.symbol, price: 103, volume: 10, ts: 2, rx: 0 },
      { symbol: 'NOT-A-SYMBOL', price: 1, volume: 1, ts: 2, rx: 0 },
    ]);
    expect(applied).toBe(1);
    const state = useStockStore.getState();
    expect(state.quoteVersion).toBe(version + 1);
    expect(state.quotes.get(first!.symbol)).toMatchObject({
      price: 103,
      direction: 1,
      dayHigh: 103,
      dayLow: 100,
      changePercent: 3,
    });
    expect(state.quotes.get(second!.symbol)).toBe(untouched);

    useStockStore
      .getState()
      .applyTicks([{ symbol: first!.symbol, price: 97, volume: 11, ts: 3, rx: 0 }]);
    expect(useStockStore.getState().quotes.get(first!.symbol)).toMatchObject({
      direction: -1,
      dayLow: 97,
      dayHigh: 103,
    });
    expect(useStockStore.getState().applyTicks([])).toBe(0);
  });

  it('folds quotes that arrived before the universe into the columns', () => {
    useStockStore
      .getState()
      .applyTicks([{ symbol: first!.symbol, price: 1, volume: 1, ts: 1, rx: 0 }]);
    expect(useStockStore.getState().quotes.size).toBe(0); // no previous close yet: ignored
    useStockStore.getState().applySnapshot([[first!.symbol, 77, 78, 76, 5, 75]], 1);
    useStockStore.getState().setUniverse(universe);
    expect(useStockStore.getState().columns!.numbers.get('price')![first!.id]).toBe(77);
    expect(useStockStore.getState().syncLiveColumns()).toBe(0); // nothing dirty any more
  });
});

describe('filter store', () => {
  beforeEach(() => useFilterStore.getState().clearAll());

  it('sets and clears filter values', () => {
    const f = useFilterStore.getState();
    f.setValue('pe', { type: 'range', max: 15 });
    expect(useFilterStore.getState().panel.values.pe).toEqual({ type: 'range', max: 15 });
    f.setValue('pe', undefined);
    expect(useFilterStore.getState().panel.values.pe).toBeUndefined();
    f.setGroupMode('fundamentals', 'OR');
    f.setRootMode('OR');
    expect(useFilterStore.getState().panel.groupModes.fundamentals).toBe('OR');
    expect(useFilterStore.getState().panel.rootMode).toBe('OR');
    f.setSearch('bank');
    f.setWatchlistOnly(true);
    f.clearAll();
    expect(useFilterStore.getState()).toMatchObject({
      search: '',
      watchlistOnly: false,
      activePresetId: null,
    });
    expect(useFilterStore.getState().panel.values).toEqual({});
  });

  it('cycles a column sort: descending → ascending → default', () => {
    const f = useFilterStore.getState();
    f.cycleSort('pe');
    expect(useFilterStore.getState().sort).toEqual({ field: 'pe', direction: 'desc' });
    f.cycleSort('pe');
    expect(useFilterStore.getState().sort).toEqual({ field: 'pe', direction: 'asc' });
    f.cycleSort('pe');
    expect(useFilterStore.getState().sort).toEqual(DEFAULT_SORT);
  });

  it('applies presets into the editable panel and saves custom screens', () => {
    const f = useFilterStore.getState();
    f.applyPreset(PRESET_BY_ID.get('value')!);
    expect(useFilterStore.getState().activePresetId).toBe('value');
    expect(Object.keys(useFilterStore.getState().panel.values)).toEqual([
      'pe',
      'roe',
      'debtToEquity',
      'dividendYield',
    ]);

    const saved = useFilterStore.getState().savePreset('  My value screen ');
    expect(saved).toMatchObject({ name: 'My value screen', builtIn: false });
    expect(saved.criteria).toContain('P/E < 15');
    expect(useFilterStore.getState().savedPresets).toHaveLength(1);
    useFilterStore.getState().deletePreset(saved.id);
    expect(useFilterStore.getState().savedPresets).toHaveLength(0);
    expect(useFilterStore.getState().activePresetId).toBeNull();
  });

  it('builds a "screen similar" query around a stock', () => {
    const stock = universe.stocks.find(s => s.pe !== null)!;
    useFilterStore.getState().screenSimilar(stock);
    const { values } = useFilterStore.getState().panel;
    expect(values.sector).toEqual({ type: 'multiselect', values: [stock.sector] });
    expect(values.marketCapCategory).toEqual({
      type: 'multiselect',
      values: [stock.marketCapCategory],
    });
    expect(values.pe).toMatchObject({ type: 'range' });
  });

  it('persists the screen to localStorage', () => {
    useFilterStore.getState().setValue('roe', { type: 'range', min: 20 });
    const stored = JSON.parse(localStorage.getItem('ep:screener')!);
    expect(stored.state.panel.values.roe).toEqual({ type: 'range', min: 20 });
    expect(stored.state.search).toBeUndefined(); // search is per-visit, not persisted
  });
});

describe('watchlist store', () => {
  beforeEach(() => useWatchlistStore.getState().clear());

  it('adds, removes and toggles without duplicates, bumping its version', () => {
    const w = useWatchlistStore.getState();
    const v0 = useWatchlistStore.getState().version;
    w.add('RELIANCE');
    w.add('RELIANCE');
    expect(useWatchlistStore.getState().items.map(i => i.symbol)).toEqual(['RELIANCE']);
    expect(w.toggle('TCS')).toBe(true);
    expect(w.toggle('TCS')).toBe(false);
    w.remove('RELIANCE');
    expect(useWatchlistStore.getState().items).toEqual([]);
    expect(useWatchlistStore.getState().version).toBeGreaterThan(v0);
  });

  it('persists locally', () => {
    useWatchlistStore.getState().add('INFY');
    expect(JSON.parse(localStorage.getItem('ep:watchlist')!).state.items[0].symbol).toBe('INFY');
  });
});

describe('ui and feed stores', () => {
  it('tracks panels, overlays and recent securities', () => {
    const ui = useUiStore.getState();
    ui.toggleFilters();
    expect(useUiStore.getState().filtersCollapsed).toBe(true);
    ui.toggleFilters(false);
    expect(useUiStore.getState().filtersCollapsed).toBe(false);
    ui.toggleContext(false);
    ui.setPalette(true);
    ui.setHelp(true);
    expect(useUiStore.getState()).toMatchObject({
      contextOpen: false,
      paletteOpen: true,
      helpOpen: true,
    });
    for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'B']) ui.pushRecent(s);
    expect(useUiStore.getState().recent).toEqual(['B', 'G', 'F', 'E', 'D', 'C']);
    ui.setColumns(c => ({ ...c, visibility: { pe: false } }));
    expect(useUiStore.getState().columns.visibility.pe).toBe(false);
    ui.resetColumns();
    expect(useUiStore.getState().columns).toEqual(DEFAULT_COLUMNS);
    ui.markEnteredFromMarket();
    expect(useUiStore.getState().enteredFromMarket).toBeGreaterThan(0);
  });

  it('records connection state, resetting retry info on each status', () => {
    const feed = useFeedStore.getState();
    feed.setStatus('reconnecting', { attempt: 2, nextRetryAt: 123 });
    expect(useFeedStore.getState()).toMatchObject({
      status: 'reconnecting',
      attempt: 2,
      nextRetryAt: 123,
    });
    feed.setStatus('live');
    expect(useFeedStore.getState()).toMatchObject({
      status: 'live',
      attempt: 0,
      nextRetryAt: null,
    });
    feed.patch({ rttMs: 12 });
    expect(useFeedStore.getState().rttMs).toBe(12);
  });
});
