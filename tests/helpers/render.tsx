import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Candle, Universe } from '@/types/market';
import { buildHistory } from '@/lib/market/history';
import { toUniverse, type MarketModel } from '@/lib/mockDataGenerator';
import { useStockStore } from '@/stores/stockStore';
import { FIXED_NOW } from '../fixtures/market';

/** Renders with the providers the app shell supplies (minus persistence). */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Object.assign(render(ui, { wrapper: Wrapper }), { queryClient });
}

/** Puts a generated universe into the stock store, as the app's loader would. */
export function loadUniverse(model: MarketModel): Universe {
  const universe = toUniverse(model);
  useStockStore.setState({
    universe: null,
    stocks: [],
    bySymbol: new Map(),
    columns: null,
    quotes: new Map(),
    quoteVersion: 0,
    dirty: new Set(),
  });
  useStockStore.getState().setUniverse(universe);
  return universe;
}

/**
 * A fetch that answers the app's history and fundamentals endpoints from the
 * generator, wrapped in the API envelope.
 */
export function historyFetch(model: MarketModel): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const match = url.pathname.match(/^\/api\/stocks\/([^/]+)\/history$/);
    if (!match)
      return new Response(
        JSON.stringify({
          success: false,
          data: null,
          meta: {},
          error: { code: 'NOT_FOUND', message: 'nope' },
        }),
        { status: 404 },
      );
    const symbol = decodeURIComponent(match[1]!);
    const id = model.bySymbol.get(symbol)!;
    const interval = (url.searchParams.get('interval') ?? '1d') as Parameters<
      typeof buildHistory
    >[2];
    const limit = Number(url.searchParams.get('limit')) || undefined;
    const candles: Candle[] = buildHistory(model, id, interval, limit, FIXED_NOW);
    const body = {
      success: true,
      data: { symbol, interval, candles },
      meta: { timestamp: '', executionTimeMs: 0, requestId: 'x', version: model.meta.version },
    };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
