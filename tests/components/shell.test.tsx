import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedController } from '@/lib/feed/controller';
import { recordFilter, resetPerformance, setGauge } from '@/lib/performance';
import { useFeedStore } from '@/stores/feedStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { ConnectionStatus } from '@/components/Layout/ConnectionStatus';
import PerformanceMonitor from '@/components/Layout/PerformanceMonitor';
import { StatusBar } from '@/components/Layout/StatusBar';
import { TopNav } from '@/components/Layout/TopNav';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { market } from '../fixtures/market';
import { loadUniverse, renderWithProviders } from '../helpers/render';
import { navigation } from '../helpers/router';

beforeEach(() => {
  loadUniverse(market(40));
  useFeedStore.setState({
    status: 'live',
    transport: 'worker',
    ticksPerSecond: 120,
    rttMs: 3,
    attempt: 0,
    nextRetryAt: null,
  });
  useUiStore.setState({ paletteOpen: false, perfOpen: false, theme: 'light' });
  useWatchlistStore.getState().clear();
  document.documentElement.dataset.theme = 'light';
});

describe('top navigation', () => {
  it('marks the current section and opens the palette', async () => {
    const user = userEvent.setup();
    navigation.pathname = '/screener';
    renderWithProviders(<TopNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Screener' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Markets' })).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: /^Search securities, actions/ }));
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });

  it('counts watched securities and switches theme', async () => {
    const user = userEvent.setup();
    useWatchlistStore.getState().add('TCS');
    useWatchlistStore.getState().add('INFY');
    renderWithProviders(<TopNav />);
    expect(screen.getByRole('link', { name: /Watchlist/ })).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: /Switch to dark theme/ }));
    expect(useUiStore.getState().theme).toBe('dark');
  });
});

describe('connection status', () => {
  it('shows each state and counts down to the next retry from the real clock', () => {
    // Only Date is faked: the countdown's interval stays real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T06:00:00Z'));
    renderWithProviders(<ConnectionStatus />);
    expect(screen.getByRole('button', { name: /Market feed live/ })).toHaveTextContent('LIVE');

    // The link drops ten minutes after the indicator mounted.
    vi.setSystemTime(new Date('2026-10-01T06:10:00Z'));
    act(() =>
      useFeedStore
        .getState()
        .setStatus('reconnecting', { attempt: 2, nextRetryAt: Date.now() + 3500 }),
    );
    expect(screen.getByRole('button', { name: /Market feed reconnecting/ })).toHaveTextContent(
      'RECONNECTING · 4s · #2',
    );

    act(() => useFeedStore.getState().setStatus('offline'));
    expect(screen.getByRole('button', { name: /Market feed offline/ })).toHaveTextContent(
      'OFFLINE',
    );
    vi.useRealTimers();
  });

  it('opens feed details with recovery actions', async () => {
    const user = userEvent.setup();
    const drop = vi.spyOn(feedController, 'simulateDrop').mockImplementation(() => {});
    const retry = vi.spyOn(feedController, 'retryNow').mockImplementation(() => {});
    renderWithProviders(<ConnectionStatus />);
    await user.click(screen.getByRole('button', { name: /Show connection details/ }));
    const details = await screen.findByRole('dialog', { name: 'Market feed details' });
    expect(details).toHaveTextContent('Updates / second');
    expect(details).toHaveTextContent('3 ms');
    await user.click(within(details).getByRole('button', { name: /simulate/i }));
    expect(drop).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Show connection details/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Market feed details' })).getByRole(
        'button',
        { name: /reconnect|retry/i },
      ),
    );
    expect(retry).toHaveBeenCalled();
  });
});

describe('status bar', () => {
  it('discloses simulated data and reports the live feed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StatusBar />);
    const bar = screen.getByRole('contentinfo');
    expect(bar).toHaveTextContent('SIMULATED MARKET DATA');
    expect(bar).toHaveTextContent('NOT INVESTMENT ADVICE');
    expect(bar).toHaveTextContent('UNIVERSE 40');
    expect(bar).toHaveTextContent('FEED WORKER · 120 UPD/S · RTT 3 MS');
    await user.click(within(bar).getByRole('button', { name: 'PERF' }));
    expect(useUiStore.getState().perfOpen).toBe(true);
  });
});

describe('performance monitor', () => {
  it('shows measured numbers, not targets', async () => {
    const user = userEvent.setup();
    resetPerformance();
    [4, 6, 5].forEach(recordFilter);
    setGauge('gridRows', 31);
    useUiStore.setState({ perfOpen: true });
    renderWithProviders(<PerformanceMonitor />);
    const panel = screen.getByRole('complementary', { name: 'Performance monitor' });
    await waitFor(() => expect(panel).toHaveTextContent(/Filter/));
    expect(panel).toHaveTextContent(/31/);
    await user.click(within(panel).getByRole('button', { name: 'Close performance monitor' }));
    expect(useUiStore.getState().perfOpen).toBe(false);
  });
});

describe('error boundary', () => {
  function Boom(): never {
    throw new Error('kaboom at Boom (secret.ts:1:1)');
  }

  it('contains a failure to its region and hides the stack trace', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Maybe() {
      if (fail) return <Boom />;
      return <p>Recovered</p>;
    }
    renderWithProviders(
      <ErrorBoundary
        region="Results grid"
        title="Results temporarily unavailable."
        description="Your filters are intact."
      >
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Results temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/secret\.ts/)).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});
