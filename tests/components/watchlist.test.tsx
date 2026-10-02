import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPrice } from '@/lib/format';
import { useStockStore } from '@/stores/stockStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { WatchlistWorkspace } from '@/components/Watchlist/WatchlistWorkspace';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse, renderWithProviders } from '../helpers/render';
import { router } from '../helpers/router';

const model = market(300);

beforeEach(async () => {
  loadUniverse(model);
  useWatchlistStore.getState().clear();
  await useWatchlistStore.persist.rehydrate();
  vi.stubGlobal('fetch', historyFetch(model));
});

describe('watchlist workspace', () => {
  it('explains an empty watchlist', async () => {
    renderWithProviders(<WatchlistWorkspace />);
    expect(await screen.findByText('Your watchlist is empty.')).toBeInTheDocument();
    expect(screen.getByText('Add securities to monitor them here.')).toBeInTheDocument();
  });

  it('monitors watched securities with live prices', async () => {
    useWatchlistStore.getState().add('TCS');
    useWatchlistStore.getState().add('RELIANCE');
    renderWithProviders(<WatchlistWorkspace />);
    expect(await screen.findAllByText('RELIANCE')).not.toHaveLength(0);
    expect(screen.getAllByText('TCS').length).toBeGreaterThan(0);

    const tcs = model.stocks.find(s => s.symbol === 'TCS')!;
    act(() => {
      useStockStore
        .getState()
        .applySnapshot(
          [['TCS', tcs.price, tcs.dayHigh, tcs.dayLow, tcs.volume, tcs.previousClose]],
          1,
        );
      useStockStore
        .getState()
        .applyTicks([{ symbol: 'TCS', price: 4321.1, volume: tcs.volume + 5, ts: 2, rx: 0 }]);
    });
    await waitFor(() => expect(screen.getAllByText(formatPrice(4321.1)).length).toBeGreaterThan(0));
  });

  it('removes a security', async () => {
    const user = userEvent.setup();
    useWatchlistStore.getState().add('INFY');
    renderWithProviders(<WatchlistWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Remove INFY from watchlist' }));
    expect(useWatchlistStore.getState().items).toEqual([]);
    expect(await screen.findByText('Your watchlist is empty.')).toBeInTheDocument();
  });

  it('opens a security’s page from its row', async () => {
    const user = userEvent.setup();
    useWatchlistStore.getState().add('INFY');
    renderWithProviders(<WatchlistWorkspace />);
    const rows = await screen.findAllByRole('row');
    const row = rows.find(r => within(r).queryByText('INFY'))!;
    await user.dblClick(row);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/INFY'));
  });
});
