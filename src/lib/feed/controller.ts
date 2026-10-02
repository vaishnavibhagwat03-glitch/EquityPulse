import type { Universe } from '@/types/market';
import type { EngineInstrument } from '@/lib/priceSimulator';
import { recordFlush } from '@/lib/performance';
import { useFeedStore } from '@/stores/feedStore';
import { useStockStore } from '@/stores/stockStore';
import { TickBatcher } from './batcher';
import { FeedClient } from './client';
import { WebSocketTransport, WorkerTransport, type WorkerInbound } from './transports';

/**
 * Wires the feed into the application: FeedClient → TickBatcher → stores.
 *
 * Transport selection: `NEXT_PUBLIC_FEED_URL` set → WebSocket to the `ws`
 * feed server; unset → the same engine in a Web Worker. One controller per
 * page lifetime, reference-counted so React StrictMode's double-mount in
 * development does not tear the connection down and rebuild it.
 */

const FEED_URL = process.env.NEXT_PUBLIC_FEED_URL?.trim() || '';

class FeedController {
  readonly mode: 'ws' | 'worker' = FEED_URL ? 'ws' : 'worker';
  private client: FeedClient | null = null;
  private batcher: TickBatcher | null = null;
  private worker: Worker | null = null;
  private workerVersion: string | null = null;
  private refs = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private ticksThisSecond = 0;

  acquire(): void {
    this.refs++;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.mode === 'ws' || this.workerVersion) this.ensureClient();
    // Worker mode waits for the universe; show that the engine is coming up.
    else if (useFeedStore.getState().status === 'idle')
      useFeedStore.getState().setStatus('connecting');
  }

  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) this.stopTimer = setTimeout(() => this.teardown(), 1500);
  }

  /** Worker mode cannot stream until it knows the instruments. */
  provideUniverse(universe: Universe): void {
    if (this.mode !== 'worker' || typeof Worker === 'undefined') return;
    if (this.workerVersion === universe.meta.version) return;
    this.worker ??= new Worker(new URL('../../workers/marketFeed.worker.ts', import.meta.url), {
      type: 'module',
      name: 'equitypulse-feed',
    });
    const instruments: EngineInstrument[] = universe.stocks.map(s => ({
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      price: s.price,
      previousClose: s.previousClose,
      dayHigh: s.dayHigh,
      dayLow: s.dayLow,
      volume: s.volume,
      avgVolume: s.avgVolume,
      sharesOutstanding: s.sharesOutstanding,
      week52High: s.week52High,
      week52Low: s.week52Low,
      beta: s.beta,
      volatility: s.volatility,
      indices: s.indices,
    }));
    this.worker.postMessage({
      kind: 'init',
      instruments,
      version: universe.meta.version,
    } satisfies WorkerInbound);
    this.workerVersion = universe.meta.version;
    if (this.refs > 0) this.ensureClient();
  }

  private ensureClient(): void {
    if (this.client) return;
    const feed = useFeedStore.getState();
    feed.patch({ transport: this.mode });

    this.batcher = new TickBatcher(ticks => {
      const t0 = performance.now();
      const applied = useStockStore.getState().applyTicks(ticks);
      this.ticksThisSecond += applied;
      recordFlush(performance.now() - t0);
    });

    this.client = new FeedClient({
      createTransport: () =>
        this.mode === 'ws' ? new WebSocketTransport(FEED_URL) : new WorkerTransport(this.worker!),
      onStatus: (status, info) => {
        useFeedStore
          .getState()
          .setStatus(status, { attempt: info.attempt, nextRetryAt: info.nextRetryAt });
      },
      onHello: info => {
        useFeedStore
          .getState()
          .patch({ universeVersion: info.universe, transport: info.transport });
      },
      onSnapshot: (quotes, ts) => {
        this.batcher?.flushNow();
        useStockStore.getState().applySnapshot(quotes, ts);
        useFeedStore.getState().patch({ synced: true, lastMessageAt: Date.now() });
      },
      onTicks: updates => this.batcher?.push(updates),
      onMarket: (market, ts) => useFeedStore.getState().setMarket(market, ts),
      onRtt: ms => useFeedStore.getState().patch({ rttMs: Math.round(ms) }),
    });
    this.client.start();

    this.meterTimer = setInterval(() => {
      useFeedStore.getState().patch({
        ticksPerSecond: this.ticksThisSecond,
        lastMessageAt: this.client?.metrics.lastMessageAt ?? null,
      });
      this.ticksThisSecond = 0;
    }, 1000);
  }

  private teardown(): void {
    this.client?.stop();
    this.client = null;
    this.batcher?.dispose();
    this.batcher = null;
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
  }

  simulateDrop(): void {
    this.client?.simulateDrop();
  }

  retryNow(): void {
    if (this.client) this.client.retryNow();
    else this.ensureClient();
  }

  setRate(ticksPerSecond: number): void {
    this.client?.send({ type: 'rate', ticksPerSecond });
  }

  get metrics() {
    return this.client?.metrics ?? null;
  }
}

export const feedController = new FeedController();
