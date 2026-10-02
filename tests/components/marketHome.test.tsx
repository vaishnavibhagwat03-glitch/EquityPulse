import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketOverview } from '@/types/market';
import { buildOverview } from '@/lib/mockDataGenerator';
import { INTRO_STORAGE_KEY } from '@/lib/boot';
import { useFeedStore } from '@/stores/feedStore';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { bootInputFromOverview } from '@/components/Boot/bootInput';
import { MarketHome } from '@/components/MarketOverview/MarketHome';
import { MarketGridSkeleton } from '@/components/MarketOverview/MarketGridSkeleton';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse, renderWithProviders } from '../helpers/render';
import { router } from '../helpers/router';

const model = market(300);
const overview: MarketOverview = buildOverview(model);
const boot = bootInputFromOverview(overview);

function resetFeed(): void {
  useFeedStore.setState({ status: 'idle', synced: false, market: null, marketTs: null });
}

beforeEach(async () => {
  resetFeed();
  useStockStore.setState({
    universe: null,
    stocks: [],
    bySymbol: new Map(),
    columns: null,
    quotes: new Map(),
    quoteVersion: 0,
    dirty: new Set(),
  });
  useFilterStore.getState().clearAll();
  useWatchlistStore.getState().clear();
  await useWatchlistStore.persist.rehydrate();
  await useUiStore.persist.rehydrate();
  useUiStore.setState({ recent: [], enteredFromMarket: null });
  vi.stubGlobal('fetch', historyFetch(model));
});

describe('market home', () => {
  it('renders the masthead and the market grid from the server snapshot', () => {
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Market intelligence.Without the noise.',
    );
    expect(
      screen.getByText(
        'Screen 5,000+ NSE & BSE securities using fundamental and technical signals.',
      ),
    ).toBeInTheDocument();
    for (const name of ['NIFTY 50', 'SENSEX', 'BANK NIFTY', 'NIFTY IT']) {
      expect(screen.getByRole('article', { name: new RegExp(`^${name}:`) })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Market breadth' })).toHaveTextContent('Advancing');
    expect(screen.getByRole('region', { name: 'Sector movement' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Top movers' })).toHaveTextContent(
      overview.movers.gainers[0]!.symbol,
    );
  });

  it('opens the screener from the market grid, marking the hand-off', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    // The masthead's primary action (the section head repeats it as a link-style button).
    await user.click(screen.getAllByRole('button', { name: /open screener/i })[0]!);
    expect(router.push).toHaveBeenCalledWith('/screener');
    expect(useUiStore.getState().enteredFromMarket).not.toBeNull();
  });

  it('screens a sector straight from its movement row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const sector = overview.sectors[0]!.name;
    const region = screen.getByRole('region', { name: 'Sector movement' });
    await user.click(within(region).getByText(sector));
    expect(useFilterStore.getState().panel.values.sector).toEqual({
      type: 'multiselect',
      values: [sector],
    });
    expect(router.push).toHaveBeenCalledWith('/screener');
  });

  it('expands the sector list on request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const region = screen.getByRole('region', { name: 'Sector movement' });
    const toggle = within(region).getByRole('button', { name: /Show all/ });
    const before = within(region).getAllByRole('listitem').length;
    await user.click(toggle);
    expect(within(region).getAllByRole('listitem').length).toBeGreaterThan(before - 1);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('counts each preset screen with the live engine once the universe loads', async () => {
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    // Each card's accessible name is its visible text (WCAG 2.5.3), starting with the screen's name.
    expect(
      screen.getByRole('button', { name: /^Value Stocks\s*counting matches/ }),
    ).toBeInTheDocument();
    act(() => void loadUniverse(model));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Value Stocks\s*\d+\s*matches/ }),
      ).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Value Stocks\s*\d+\s*matches/ }));
    expect(useFilterStore.getState().activePresetId).toBe('value');
  });

  it('shows the watchlist, or explains how to start one', async () => {
    const { unmount } = renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    expect(await screen.findByText('Your watchlist is empty.')).toBeInTheDocument();
    unmount();
    act(() => {
      loadUniverse(model);
      useWatchlistStore.getState().add('TCS');
    });
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const discover = screen.getByRole('region', { name: 'Discover' });
    expect(await within(discover).findByText('TCS')).toBeInTheDocument();
  });

  it('goes live: breadth and indices follow the feed', async () => {
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const live = {
      ...overview,
      breadth: { ...overview.breadth, advancing: 4242 },
      indices: overview.indices.map(i => ({
        id: i.id,
        value: i.value + 100,
        change: i.change + 100,
        changePercent: i.changePercent,
        advancing: i.advancing,
        declining: i.declining,
      })),
      sectors: overview.sectors.map(s => ({
        name: s.name,
        changePercent: s.changePercent,
        advancing: s.advancing,
        declining: s.declining,
      })),
    };
    act(() => {
      useFeedStore.getState().setStatus('live');
      useFeedStore.getState().setMarket(live, Date.now());
    });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Market breadth' })).toHaveTextContent('4,242'),
    );
    expect(screen.getAllByText('Simulated session live').length).toBeGreaterThan(0);
  });

  it('has a structural skeleton for the overview', () => {
    renderWithProviders(<MarketGridSkeleton />);
    expect(screen.getByLabelText('Loading market overview')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('boot sequence', () => {
  const ready = (): void => {
    loadUniverse(model);
    useFeedStore.setState({ status: 'live', synced: true });
  };

  it('stays out of the way when the head script chose no intro', () => {
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const overlay = document.querySelector('.boot-root')!;
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveAttribute('data-beat', 'frame');
  });

  it('reduced motion: a static frame, then a plain hand-off', async () => {
    document.documentElement.dataset.intro = 'reduced';
    ready();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    await waitFor(() => expect(document.documentElement.dataset.intro).toBe('handoff'), {
      timeout: 3000,
    });
    await waitFor(() => expect(document.querySelector('.boot-root')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(document.documentElement.dataset.intro).toBe('done'), {
      timeout: 3000,
    });
  });

  it('first visit: plays through every beat, records it was seen, then hands over', async () => {
    // In a browser performance.now() counts from navigation; in the test
    // worker it counts from worker start. Rebase it to "page just loaded" so
    // the slow-start downgrade does not apply.
    const realNow = performance.now.bind(performance);
    const origin = realNow();
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() - origin);
    document.documentElement.dataset.intro = 'full';
    ready();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const root = document.querySelector<HTMLElement>('.boot-root')!;
    expect(JSON.parse(localStorage.getItem(INTRO_STORAGE_KEY)!).seen).toBeGreaterThan(0);
    const beats = new Set<string>();
    const observer = new MutationObserver(() => beats.add(root.dataset.beat ?? ''));
    observer.observe(root, { attributes: true, attributeFilter: ['data-beat'] });
    await waitFor(() => expect(root.textContent).toContain('300 securities ready'), {
      timeout: 4000,
    });
    await waitFor(() => expect(document.documentElement.dataset.intro).toBe('done'), {
      timeout: 6000,
    });
    observer.disconnect();
    expect([...beats]).toEqual(
      expect.arrayContaining(['signal', 'grid', 'sweep', 'compress', 'reveal', 'handoff']),
    );
    expect(document.querySelector('.boot-root')).toBeNull();
  }, 15_000);

  /** In a browser performance.now() counts from navigation; rebase it to "page just loaded". */
  const freshPageClock = (): void => {
    const realNow = performance.now.bind(performance);
    const origin = realNow();
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() - origin);
  };

  it('skips to the hand-off on a key press', async () => {
    freshPageClock();
    document.documentElement.dataset.intro = 'full';
    ready();
    const user = userEvent.setup();
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.documentElement.dataset.intro).toBe('handoff'), {
      timeout: 1000,
    });
  });

  it('a slow start downgrades the first visit to the short CSS sequence', async () => {
    // The worker has been running for seconds: hydration looks slow.
    document.documentElement.dataset.intro = 'full';
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    expect(document.documentElement.dataset.intro).toBe('return');
    expect(JSON.parse(localStorage.getItem(INTRO_STORAGE_KEY)!).seen).toBeGreaterThan(0);
  });

  it('return visit: CSS runs the sequence; script only tidies up once it has settled', async () => {
    freshPageClock();
    document.documentElement.dataset.intro = 'return';
    renderWithProviders(<MarketHome snapshot={overview} boot={boot} />);
    const root = document.querySelector<HTMLElement>('.boot-root')!;
    // No script-driven beats: the canvas loop never starts.
    expect(root.dataset.beat).toBe('frame');
    expect(root.dataset.mode).toBeUndefined();
    await waitFor(() => expect(document.documentElement.dataset.intro).toBe('done'), {
      timeout: 4000,
    });
    expect(document.querySelector('.boot-root')).toBeNull();
  });
});
