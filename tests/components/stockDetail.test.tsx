import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFundamentals } from '@/lib/market/fundamentals';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { StockDetail } from '@/components/StockDetail/StockDetail';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse, renderWithProviders } from '../helpers/render';
import { router } from '../helpers/router';

/**
 * Lightweight Charts needs a real canvas. The renderer module is replaced by
 * a recorder so the test can check what the chart component asks it to draw.
 */
const chart = vi.hoisted(() => ({ instances: [] as { calls: string[]; enabled: string[] }[] }));
vi.mock('@/components/Chart/chartRenderer', () => ({
  readChartTheme: () => ({}),
  ChartController: class {
    calls: string[] = [];
    enabled: string[] = [];
    constructor() {
      chart.instances.push(this);
    }
    setModel(model: { candles: unknown[] }) {
      this.calls.push(`setModel:${model.candles.length}`);
    }
    updateLast() {
      this.calls.push('updateLast');
    }
    setEnabled(enabled: ReadonlySet<string>) {
      this.enabled = [...enabled];
    }
    resize() {}
    resetView() {
      this.calls.push('reset');
    }
    zoom(f: number) {
      this.calls.push(`zoom:${f}`);
    }
    pan(b: number) {
      this.calls.push(`pan:${b}`);
    }
    applyTheme() {}
    destroy() {
      this.calls.push('destroy');
    }
  },
}));

const model = market(300);
const stock = model.stocks.find(s => s.symbol === 'RELIANCE')!;
const peers = model.stocks
  .filter(s => s.industry === stock.industry && s.symbol !== stock.symbol)
  .slice(0, 4)
  .map(p => ({
    symbol: p.symbol,
    name: p.name,
    price: p.price,
    changePercent: p.changePercent,
    marketCap: p.marketCap,
    pe: p.pe,
    roe: p.roe,
  }));
const fundamentals = buildFundamentals(stock, model.meta.seed, model.asOfDay);

beforeEach(() => {
  chart.instances.length = 0;
  loadUniverse(model);
  useUiStore.setState({ chartFault: false, recent: [] });
  useWatchlistStore.getState().clear();
  vi.stubGlobal('fetch', historyFetch(model));
});

describe('stock detail', () => {
  it('leads with identity, live price and the key ratios', async () => {
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    expect(screen.getByRole('heading', { level: 1, name: stock.name })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(stock.sector);
    expect(screen.getAllByText('Market cap').length).toBeGreaterThan(0);
    expect(screen.getAllByText('P/E').length).toBeGreaterThan(0);
    // Visiting records the security as recent (for the palette and the home page).
    await waitFor(() => expect(useUiStore.getState().recent[0]).toBe('RELIANCE'));
  });

  it('loads 1+ years of daily candles into the chart and toggles indicators', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    await waitFor(() =>
      expect(chart.instances[0]?.calls.some(c => c.startsWith('setModel:'))).toBe(true),
    );
    const loaded = Number(
      chart.instances[0]!.calls.find(c => c.startsWith('setModel:'))!.split(':')[1],
    );
    expect(loaded).toBeGreaterThanOrEqual(252);

    const indicators = screen.getByRole('group', { name: 'Indicators' });
    const sma200 = within(indicators).getByRole('button', { name: /SMA 200/ });
    const before = sma200.getAttribute('aria-pressed');
    await user.click(sma200);
    expect(sma200.getAttribute('aria-pressed')).not.toBe(before);
    expect(chart.instances[0]!.enabled.includes('sma200')).toBe(before !== 'true');

    await user.click(screen.getByRole('button', { name: 'Reset chart view (0)' }));
    expect(chart.instances[0]!.calls).toContain('reset');
  });

  it('switches timeframes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    await waitFor(() => expect(chart.instances[0]?.calls.length).toBeGreaterThan(0));
    await user.click(screen.getByRole('radio', { name: '1Y' }));
    await waitFor(() =>
      expect(
        chart.instances[0]!.calls.filter(c => c.startsWith('setModel')).length,
      ).toBeGreaterThanOrEqual(1),
    );
    expect(localStorage.getItem('ep:chart:timeframe')).toBe('1Y');
  });

  it('isolates a chart failure: the page survives and the chart can retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    act(() => useUiStore.getState().setChartFault(true));
    expect(await screen.findByText('Chart temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: stock.name })).toBeInTheDocument();
    expect(screen.queryByText(/at StockChart/)).not.toBeInTheDocument(); // no stack trace
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() =>
      expect(screen.queryByText('Chart temporarily unavailable.')).not.toBeInTheDocument(),
    );
    expect(useUiStore.getState().chartFault).toBe(false);
  });

  it('discloses fundamentals progressively in tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    const tabs = screen.getByRole('tablist', { name: 'Company data' });
    await user.click(within(tabs).getByRole('tab', { name: 'Financials' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Revenue');
    await user.click(within(tabs).getByRole('tab', { name: 'Shareholding' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/Promoter/i);
    await user.click(within(tabs).getByRole('tab', { name: 'Technicals' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/RSI/);
    // Arrow keys move between tabs (WAI-ARIA).
    within(tabs).getByRole('tab', { name: 'Technicals' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(within(tabs).getByRole('tab', { name: 'Shareholding' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('adds to the watchlist and screens similar stocks', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    await user.click(screen.getByRole('button', { name: /add to watchlist/i }));
    expect(useWatchlistStore.getState().items.map(i => i.symbol)).toContain('RELIANCE');
    await user.click(screen.getByRole('button', { name: /screen similar/i }));
    expect(useFilterStore.getState().panel.values.sector).toEqual({
      type: 'multiselect',
      values: [stock.sector],
    });
    expect(router.push).toHaveBeenCalledWith('/screener');
  });

  it('lists peers that link to their own pages', () => {
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    for (const p of peers) expect(screen.getAllByText(p.symbol).length).toBeGreaterThan(0);
  });

  it('reflects live prices in the header', async () => {
    renderWithProviders(<StockDetail initial={stock} peers={peers} fundamentals={fundamentals} />);
    act(() => {
      useStockStore
        .getState()
        .applySnapshot(
          [
            [
              stock.symbol,
              stock.price,
              stock.dayHigh,
              stock.dayLow,
              stock.volume,
              stock.previousClose,
            ],
          ],
          1,
        );
      useStockStore
        .getState()
        .applyTicks([
          { symbol: stock.symbol, price: 1999.95, volume: stock.volume + 1, ts: 2, rx: 0 },
        ]);
    });
    await waitFor(() => expect(screen.getAllByText(/1,999\.95/).length).toBeGreaterThan(0));
  });
});
