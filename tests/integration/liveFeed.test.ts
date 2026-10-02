import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFeedServer, type FeedServer } from '../../server/feedServer';
import { toUniverse } from '@/lib/mockDataGenerator';
import { market } from '../fixtures/market';
import type * as Controller from '@/lib/feed/controller';
import type * as FeedStore from '@/stores/feedStore';
import type * as StockStore from '@/stores/stockStore';

/**
 * The whole live path, as the app runs it with NEXT_PUBLIC_FEED_URL set:
 * `ws` feed server → WebSocket → FeedClient → TickBatcher → Zustand stores.
 */

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise(r => setTimeout(r, 10));
  }
}

let server: FeedServer;
let app: {
  feedController: typeof Controller.feedController;
  useStockStore: typeof StockStore.useStockStore;
  useFeedStore: typeof FeedStore.useFeedStore;
};

beforeAll(async () => {
  server = await createFeedServer({
    port: 0,
    host: '127.0.0.1',
    model: market(300),
    seed: 21,
    tickIntervalMs: 50,
    marketIntervalMs: 200,
    ticksPerSecond: 200,
  });
  // The controller picks its transport from the environment at import time.
  vi.stubEnv('NEXT_PUBLIC_FEED_URL', `ws://127.0.0.1:${server.port}`);
  vi.resetModules();
  app = {
    feedController: (await import('@/lib/feed/controller')).feedController,
    useStockStore: (await import('@/stores/stockStore')).useStockStore,
    useFeedStore: (await import('@/stores/feedStore')).useFeedStore,
  };
  app.useStockStore.getState().setUniverse(toUniverse(market(300)));
});

afterAll(async () => {
  app.feedController.release();
  await new Promise(r => setTimeout(r, 1600)); // the controller tears down after a grace period
  vi.unstubAllEnvs();
  await server.close();
});

describe('live feed into the stores', () => {
  it('connects over WebSocket, syncs a snapshot and streams ticks into quotes', async () => {
    app.feedController.acquire();
    expect(app.feedController.mode).toBe('ws');
    await until(
      () => app.useFeedStore.getState().status === 'live' && app.useFeedStore.getState().synced,
    );
    expect(app.useFeedStore.getState().transport).toBe('ws');
    expect(app.useStockStore.getState().quotes.size).toBe(300);

    const version = app.useStockStore.getState().quoteVersion;
    await until(() => app.useStockStore.getState().quoteVersion > version + 5);
    await until(() => app.useFeedStore.getState().market !== null);
    expect(app.useFeedStore.getState().market!.breadth.total).toBe(300);
  });

  it('gives a new object only to symbols that ticked (no full-grid re-render)', async () => {
    const before = new Map(app.useStockStore.getState().quotes);
    const version = app.useStockStore.getState().quoteVersion;
    await until(() => app.useStockStore.getState().quoteVersion > version);
    const after = app.useStockStore.getState().quotes;
    let changed = 0;
    let same = 0;
    for (const [symbol, quote] of after) {
      if (quote === before.get(symbol)) same++;
      else changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(same).toBeGreaterThan(0);
    expect(changed).toBeLessThan(300);
  });

  it('keeps the last prices through a disconnect and resumes on its own', async () => {
    const priceOf = (symbol: string): number | undefined =>
      app.useStockStore.getState().quotes.get(symbol)?.price;
    const symbol = server.model.stocks[0]!.symbol;
    server.dropAllClients();
    await until(() => app.useFeedStore.getState().status === 'reconnecting');
    // Nothing is cleared while reconnecting.
    expect(app.useStockStore.getState().quotes.size).toBe(300);
    expect(priceOf(symbol)).toBeGreaterThan(0);
    await until(() => app.useFeedStore.getState().status === 'live');
  });

  it('folds live quotes into the filter columns on demand', () => {
    const store = app.useStockStore.getState();
    const liveVersion = store.columns!.liveVersion;
    store.syncLiveColumns();
    const quote = store.quotes.get(server.model.stocks[0]!.symbol)!;
    const price = store.columns!.numbers.get('price')![0];
    expect(price).toBe(quote.price);
    expect(store.columns!.liveVersion).toBeGreaterThanOrEqual(liveVersion);
  });
});
