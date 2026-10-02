import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterEngine } from '@/lib/filterEngine';
import { buildColumnStore } from '@/lib/filters/columnStore';
import { panelToExpression } from '@/lib/filters/panel';
import { panelFromPreset, PRESET_BY_ID } from '@/lib/filters/presets';
import { formatInteger, formatPrice } from '@/lib/format';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { ScreenerWorkspace } from '@/components/Screener/ScreenerWorkspace';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse, renderWithProviders } from '../helpers/render';
import { router } from '../helpers/router';

const model = market(300);

/** "N of 300 securities" in the screener header. */
const headerCount = (): string => screen.getByText(/of\s+300\s+securities/i).textContent ?? '';

// jsdom has no layout. The virtualiser measures its scroll container with
// offsetWidth / offsetHeight: give elements a desktop-sized box.
const offsets = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 700,
  });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsets.offsetWidth!);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsets.offsetHeight!);
});

beforeEach(() => {
  loadUniverse(model);
  useFilterStore.getState().clearAll();
  useFilterStore.getState().setSort({ field: 'marketCap', direction: 'desc' });
  useUiStore.setState({ selectedSymbol: null, contextOpen: true, filtersCollapsed: false });
  vi.stubGlobal('fetch', historyFetch(model));
});

describe('screener workspace', () => {
  it('shows the universe in a virtualised grid with a live match count', () => {
    renderWithProviders(<ScreenerWorkspace />);
    expect(screen.getByRole('heading', { name: 'Screener' })).toBeInTheDocument();
    expect(headerCount()).toMatch(/^300\s+of\s+300/);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row');
    // Header + a window of rows — never all 300.
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(100);
    expect(within(grid).getByText(model.stocks[0]!.symbol)).toBeInTheDocument();
  });

  it('applies a preset: chips appear and the count matches the engine', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(screen.getByRole('button', { name: /Value Stocks/ }));

    const expected = new FilterEngine(buildColumnStore(model.stocks, 'x')).screen(
      panelToExpression(panelFromPreset(PRESET_BY_ID.get('value')!)),
    ).stats.matched;
    await waitFor(() =>
      expect(headerCount()).toMatch(new RegExp(`^${formatInteger(expected)}\\s+of`)),
    );
    const chips = screen.getByRole('list', { name: 'Applied filters' });
    expect(within(chips).getByText('P/E < 15')).toBeInTheDocument();
    expect(within(chips).getByText('ROE > 15%')).toBeInTheDocument();

    // Removing a chip loosens the screen.
    await user.click(screen.getByRole('button', { name: 'Remove filter P/E < 15' }));
    await waitFor(() =>
      expect(Number(headerCount().split(/\s/)[0]!.replace(/,/g, ''))).toBeGreaterThanOrEqual(
        expected,
      ),
    );
    expect(useFilterStore.getState().panel.values.pe).toBeUndefined();
  });

  it('shows an empty state with a way out', async () => {
    const user = userEvent.setup();
    useFilterStore.getState().setValue('pe', { type: 'range', min: 1000, max: 2000 });
    renderWithProviders(<ScreenerWorkspace />);
    expect(await screen.findByText('No stocks match your filters.')).toBeInTheDocument();
    expect(screen.getByText('Try removing one or more conditions.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(headerCount()).toMatch(/^300\s+of/));
  });

  it('searches symbols and names', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.type(
      screen.getByRole('searchbox', { name: 'Search stocks, symbols, sectors' }),
      'RELIANCE',
    );
    await waitFor(() => expect(headerCount()).toMatch(/^[1-9]\d?\s+of/));
    expect(within(screen.getByRole('grid')).getByText('RELIANCE')).toBeInTheDocument();
  });

  it('sorts by a column header, toggling direction', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    const header = screen
      .getAllByRole('columnheader')
      .find(h => /^p\/e$/i.test(h.textContent?.trim() ?? ''))!;
    const sortButton = within(header).getAllByRole('button')[0]!;
    await user.click(sortButton);
    expect(useFilterStore.getState().sort).toEqual({ field: 'pe', direction: 'desc' });
    await waitFor(() => expect(header).toHaveAttribute('aria-sort', 'descending'));
    await user.click(sortButton);
    await waitFor(() => expect(header).toHaveAttribute('aria-sort', 'ascending'));
  });

  it('moves through rows with the keyboard and opens one with Enter', async () => {
    renderWithProviders(<ScreenerWorkspace />);
    const grid = screen.getByRole('grid');
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await waitFor(() => expect(grid.getAttribute('aria-activedescendant')).toBeTruthy());
    const active = grid.getAttribute('aria-activedescendant')!;
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(router.push).toHaveBeenCalledWith(`/${encodeURIComponent(active.replace(/^row-/, ''))}`);
  });

  it('updates only the ticking security’s price cell', async () => {
    renderWithProviders(<ScreenerWorkspace />);
    const top = model.stocks[0]!;
    const row = document.getElementById(`row-${top.symbol}`)!;
    const next = Math.round(top.price * 1.05 * 100) / 100;
    act(() => {
      useStockStore.getState().applySnapshot(
        model.stocks
          .slice(0, 2)
          .map(s => [s.symbol, s.price, s.dayHigh, s.dayLow, s.volume, s.previousClose]),
        1,
      );
      useStockStore.getState().applyTicks([
        {
          symbol: top.symbol,
          price: next,
          volume: top.volume + 10,
          ts: 2,
          rx: performance.now(),
        },
      ]);
    });
    await waitFor(() => expect(within(row).getByText(formatPrice(next))).toBeInTheDocument());
  });

  it('shows the selected security in the context panel', async () => {
    renderWithProviders(<ScreenerWorkspace />);
    const first = model.stocks[0]!;
    await waitFor(() => expect(useUiStore.getState().selectedSymbol).toBe(first.symbol));
    expect(await screen.findAllByText(first.name)).not.toHaveLength(0);
  });
});
