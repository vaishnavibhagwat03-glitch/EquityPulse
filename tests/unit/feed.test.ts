import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FeedClient,
  type FeedClientOptions,
  type FeedStatus,
  type TickUpdate,
} from '@/lib/feed/client';
import { TickBatcher, type BatcherScheduler, type PendingTick } from '@/lib/feed/batcher';
import {
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type QuoteTuple,
  type ServerMessage,
} from '@/lib/feed/protocol';
import type { FeedTransport, TransportHandlers } from '@/lib/feed/transports';
import { MarketEngine } from '@/lib/priceSimulator';
import { tickSizeFor } from '@/lib/market/pricePath';
import { market } from '../fixtures/market';

/* ------------------------------------------------------------------------ */
/* A scripted transport: the test plays the server.                          */
/* ------------------------------------------------------------------------ */

class FakeTransport implements FeedTransport {
  readonly kind = 'ws' as const;
  handlers: TransportHandlers | null = null;
  sent: ClientMessage[] = [];
  closed = false;
  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.handlers!.onOpen();
  }
  receive(message: ServerMessage): void {
    this.handlers!.onMessage(message);
  }
  drop(reason = 'connection lost'): void {
    this.handlers!.onClose(reason);
  }
}

const QUOTES: QuoteTuple[] = [
  ['RELIANCE', 1428.3, 1440, 1410, 1_000_000, 1400],
  ['TCS', 3147.2, 3160, 3120, 400_000, 3180],
];
const snapshot = (seq = 0): ServerMessage => ({ type: 'snapshot', seq, ts: 1, quotes: QUOTES });
const ticks = (
  seq: number,
  list: [number, number, number][] = [[0, 1429, 1_000_100]],
): ServerMessage => ({
  type: 'ticks',
  seq,
  ts: 2,
  ticks: list,
});

function setup(overrides: Partial<FeedClientOptions> = {}) {
  const transports: FakeTransport[] = [];
  const statuses: { status: FeedStatus; attempt: number; nextRetryAt: number | null }[] = [];
  const received: TickUpdate[][] = [];
  let online = true;
  const client = new FeedClient({
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    onStatus: (status, info) =>
      statuses.push({ status, attempt: info.attempt, nextRetryAt: info.nextRetryAt }),
    onTicks: updates => received.push(updates),
    random: () => 1, // no jitter: delays are exactly the exponential schedule
    isOnline: () => online,
    ...overrides,
  });
  const latest = (): FakeTransport => transports[transports.length - 1]!;
  const connect = (): FakeTransport => {
    const t = latest();
    t.open();
    t.receive({
      type: 'hello',
      protocol: 1,
      universe: 'v1',
      instruments: 2,
      serverTime: 0,
      transport: 'ws',
      tickIntervalMs: 250,
    });
    t.receive(snapshot());
    return t;
  };
  return {
    client,
    transports,
    statuses,
    received,
    latest,
    connect,
    setOnline: (v: boolean) => (online = v),
  };
}

describe('feed client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects, subscribes, and goes live on the first snapshot', () => {
    const onSnapshot = vi.fn();
    const onHello = vi.fn();
    const { client, statuses, latest, connect } = setup({ onSnapshot, onHello });
    client.start();
    expect(client.status).toBe('connecting');
    connect();
    expect(latest().sent[0]).toEqual({ type: 'subscribe', channels: ['quotes', 'market'] });
    expect(latest().sent.some(m => m.type === 'ping')).toBe(true);
    expect(onHello).toHaveBeenCalledWith({ universe: 'v1', transport: 'ws', instruments: 2 });
    expect(onSnapshot).toHaveBeenCalledWith(QUOTES, 1);
    expect(statuses.map(s => s.status)).toEqual(['connecting', 'live']);
    client.stop();
  });

  it('turns positional deltas into symbol updates', () => {
    const { client, received, latest, connect } = setup();
    client.start();
    connect();
    latest().receive(
      ticks(1, [
        [1, 3150, 400_500],
        [0, 1429, 1_000_100],
      ]),
    );
    expect(received[0]).toEqual([
      expect.objectContaining({ symbol: 'TCS', price: 3150, volume: 400_500, ts: 2 }),
      expect.objectContaining({ symbol: 'RELIANCE', price: 1429 }),
    ]);
    expect(client.metrics.ticks).toBe(2);
    client.stop();
  });

  it('asks for a resync when a sequence number is skipped, and applies what arrived', () => {
    const { client, received, connect } = setup();
    client.start();
    const t = connect();
    t.receive(ticks(1));
    expect(t.sent.filter(m => m.type === 'resync')).toHaveLength(0);
    t.receive(ticks(3));
    expect(t.sent.filter(m => m.type === 'resync')).toHaveLength(1);
    expect(client.metrics.gaps).toBe(1);
    expect(received).toHaveLength(2);
    client.stop();
  });

  it('reconnects with exponential backoff and comes back live', () => {
    const { client, transports, statuses, latest, connect } = setup({ baseMs: 800, maxMs: 15_000 });
    client.start();
    connect();
    latest().drop();
    expect(client.status).toBe('reconnecting');
    const first = statuses.at(-1)!;
    expect(first.attempt).toBe(1);
    expect(first.nextRetryAt! - Date.now()).toBe(800);

    vi.advanceTimersByTime(799);
    expect(transports).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(transports).toHaveLength(2);

    latest().drop(); // the retry fails too
    expect(statuses.at(-1)!.nextRetryAt! - Date.now()).toBe(1600);
    vi.advanceTimersByTime(1600);
    connect();
    expect(client.status).toBe('live');
    expect(client.attempt).toBe(0);
    client.stop();
  });

  it('jitters retries between half and all of the backoff delay', () => {
    for (const r of [0, 0.5, 1]) {
      const { client, statuses, latest, connect } = setup({ random: () => r, baseMs: 1000 });
      client.start();
      connect();
      latest().drop();
      expect(statuses.at(-1)!.nextRetryAt! - Date.now()).toBe(500 + 500 * r);
      client.stop();
    }
  });

  it('caps the delay, gives up after the attempt budget, and can be retried by hand', () => {
    const { client, statuses, latest } = setup({ baseMs: 1000, maxMs: 3000, maxAttempts: 3 });
    client.start();
    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().drop();
    vi.advanceTimersByTime(2000);
    latest().drop();
    expect(statuses.at(-1)!.nextRetryAt! - Date.now()).toBe(3000); // capped, not 4000
    vi.advanceTimersByTime(3000);
    latest().drop();
    expect(client.status).toBe('offline');

    client.retryNow();
    expect(client.status).toBe('connecting');
    expect(client.attempt).toBe(0);
    client.stop();
  });

  it('treats silence as a dead link (heartbeat watchdog)', () => {
    const { client, latest, connect } = setup({ heartbeatTimeoutMs: 5000 });
    client.start();
    const t = connect();
    vi.advanceTimersByTime(4999);
    expect(client.status).toBe('live');
    vi.advanceTimersByTime(1);
    expect(t.closed).toBe(true);
    expect(client.status).toBe('reconnecting');
    expect(latest()).toBe(t); // a new transport only after the backoff
    client.stop();
  });

  it('goes offline with the browser and reconnects when it is back', () => {
    // Node has no window; the client only needs its online/offline events.
    vi.stubGlobal('window', new EventTarget());
    const { client, transports, connect, setOnline } = setup();
    client.start();
    const t = connect();
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    expect(client.status).toBe('offline');
    expect(t.closed).toBe(true);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(client.status).toBe('connecting');
    expect(transports).toHaveLength(2);
    client.stop();
    vi.unstubAllGlobals();
  });

  it('does not connect while the browser is offline', () => {
    const { client, transports, setOnline } = setup();
    setOnline(false);
    client.start();
    expect(client.status).toBe('offline');
    expect(transports).toHaveLength(0);
    client.stop();
  });

  it('measures round-trip time from pongs', () => {
    const onRtt = vi.fn();
    const { client, connect } = setup({ onRtt });
    client.start();
    const t = connect();
    const ping = t.sent.find(m => m.type === 'ping') as Extract<ClientMessage, { type: 'ping' }>;
    vi.advanceTimersByTime(42);
    t.receive({ type: 'pong', id: ping.id, clientTs: ping.ts, serverTs: 0 });
    expect(onRtt).toHaveBeenCalledWith(42);
    expect(client.metrics.rttMs).toBe(42);
    client.stop();
  });

  it('ignores a superseded connection and stops cleanly', () => {
    const { client, received, transports, connect } = setup();
    client.start();
    const old = connect();
    client.retryNow();
    expect(old.closed).toBe(true);
    old.receive(ticks(1)); // late frame from the old socket
    expect(received).toHaveLength(0);
    client.simulateDrop();
    expect(client.status).toBe('reconnecting');
    client.stop();
    expect(client.status).toBe('idle');
    vi.advanceTimersByTime(60_000);
    expect(transports).toHaveLength(2); // no reconnect after stop
  });
});

describe('tick batcher', () => {
  function manualScheduler() {
    const frames = new Map<number, () => void>();
    const timeouts = new Map<number, () => void>();
    let id = 0;
    const scheduler: BatcherScheduler = {
      requestFrame: cb => (frames.set(++id, cb), id),
      cancelFrame: f => frames.delete(f),
      setTimeout: ((cb: () => void) => (
        timeouts.set(++id, cb),
        id
      )) as unknown as BatcherScheduler['setTimeout'],
      clearTimeout: (t =>
        timeouts.delete(t as unknown as number)) as BatcherScheduler['clearTimeout'],
    };
    const runFrame = (): void => [...frames.values()].forEach(cb => cb());
    const runTimeout = (): void => [...timeouts.values()].forEach(cb => cb());
    return { scheduler, frames, timeouts, runFrame, runTimeout };
  }
  const tick = (symbol: string, price: number): PendingTick => ({
    symbol,
    price,
    volume: 1,
    ts: 0,
    rx: 0,
  });

  it('keeps only the latest update per symbol and flushes once per frame', () => {
    const s = manualScheduler();
    const flushed: PendingTick[][] = [];
    const batcher = new TickBatcher(batch => flushed.push(batch), 150, s.scheduler);
    batcher.push([tick('A', 1), tick('B', 1)]);
    batcher.push([tick('A', 2)]);
    expect(s.frames.size).toBe(1); // one frame requested, not one per push
    s.runFrame();
    expect(flushed).toEqual([[tick('A', 2), tick('B', 1)]]);
    expect(s.timeouts.size).toBe(0); // the fallback timer was cancelled
    expect(batcher.stats).toEqual({ received: 3, flushed: 2, batches: 1 });
  });

  it('falls back to a timer when frames are paused (hidden tab)', () => {
    const s = manualScheduler();
    const flushed: PendingTick[][] = [];
    const batcher = new TickBatcher(batch => flushed.push(batch), 150, s.scheduler);
    batcher.push([tick('A', 1)]);
    s.runTimeout();
    expect(flushed).toHaveLength(1);
    expect(s.frames.size).toBe(0);
    batcher.push([tick('B', 1)]);
    batcher.flushNow();
    expect(flushed).toHaveLength(2);
    batcher.push([tick('C', 1)]);
    batcher.dispose();
    s.runFrame();
    expect(flushed).toHaveLength(2);
  });
});

describe('wire protocol', () => {
  it('accepts well-formed server frames and drops malformed ones', () => {
    expect(parseServerMessage(JSON.stringify(snapshot()))).toMatchObject({ type: 'snapshot' });
    expect(parseServerMessage({ type: 'heartbeat', seq: 1, ts: 1 })).toMatchObject({
      type: 'heartbeat',
    });
    expect(parseServerMessage('{not json')).toBeNull();
    expect(parseServerMessage({ type: 'nope' })).toBeNull();
    expect(parseServerMessage({ type: 'ticks', ticks: [] })).toBeNull(); // no sequence number
    expect(parseServerMessage({ type: 'snapshot', seq: 1 })).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
  });

  it('validates client messages', () => {
    expect(parseClientMessage('{"type":"resync"}')).toEqual({ type: 'resync' });
    expect(parseClientMessage({ type: 'rate', ticksPerSecond: 200 })).toMatchObject({
      type: 'rate',
    });
    expect(parseClientMessage({ type: 'rate', ticksPerSecond: 'fast' })).toBeNull();
    expect(parseClientMessage({ type: 'subscribe' })).toBeNull();
    expect(parseClientMessage({ type: 'shutdown' })).toBeNull();
  });
});

describe('market engine (price simulator)', () => {
  const stocks = market(300).stocks;
  const T0 = 1_790_000_000_000;

  it('is deterministic for a seed', () => {
    const a = new MarketEngine(stocks, { seed: 7, startTime: T0 });
    const b = new MarketEngine(stocks, { seed: 7, startTime: T0 });
    for (let k = 1; k <= 20; k++) expect(a.step(T0 + k * 250)).toEqual(b.step(T0 + k * 250));
  });

  it('starts from the snapshot and only trades when time passes', () => {
    const engine = new MarketEngine(stocks, { seed: 1, startTime: T0 });
    expect(engine.snapshot()[0]).toEqual([
      stocks[0]!.symbol,
      stocks[0]!.price,
      stocks[0]!.dayHigh,
      stocks[0]!.dayLow,
      stocks[0]!.volume,
      stocks[0]!.previousClose,
    ]);
    expect(engine.step(T0)).toEqual([]);
    expect(engine.step(T0 + 1000).length).toBeGreaterThan(0);
    expect(engine.sequence).toBe(1);
  });

  it('respects circuit bands and NSE tick sizes over a long session', () => {
    const engine = new MarketEngine(stocks, { seed: 3, startTime: T0, ticksPerSecond: 400 });
    const lastVolume = Float64Array.from(engine.volume);
    const violations: string[] = [];
    let checked = 0;
    // Twenty minutes of wall-clock trading (~6.7 market hours at 20× time).
    for (let k = 1; k <= 1200; k++) {
      for (const [i, price, volume] of engine.step(T0 + k * 1000)) {
        checked++;
        const s = stocks[i]!;
        const band = s.indices.includes('NIFTY 500') ? 0.2 : 0.1;
        const tick = tickSizeFor(price);
        // Circuit limits are themselves rounded to the tick grid.
        if (
          price > s.previousClose * (1 + band) + tick ||
          price < s.previousClose * (1 - band) - tick
        ) {
          violations.push(`${s.symbol} ${price} outside ±${band * 100}% of ${s.previousClose}`);
        }
        if (Math.abs(price / tick - Math.round(price / tick)) > 1e-6)
          violations.push(`${s.symbol} ${price} off the ${tick} tick grid`);
        if (volume < lastVolume[i]!) violations.push(`${s.symbol} volume fell`);
        if (engine.dayHigh[i]! < price || engine.dayLow[i]! > price)
          violations.push(`${s.symbol} outside its day range`);
        lastVolume[i] = volume;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(violations.slice(0, 5)).toEqual([]);
  });

  it('aggregates the live market', () => {
    const engine = new MarketEngine(stocks, { seed: 5, startTime: T0 });
    for (let k = 1; k <= 30; k++) engine.step(T0 + k * 500);
    const live = engine.market();
    expect(live.breadth.total).toBe(stocks.length);
    expect(live.breadth.advancing + live.breadth.declining + live.breadth.unchanged).toBe(
      stocks.length,
    );
    expect(live.distribution.reduce((a, b) => a + b, 0)).toBe(stocks.length);
    expect(live.indices.find(i => i.id === 'NIFTY50')!.value).toBeGreaterThan(0);
    expect(live.movers.gainers.length).toBeGreaterThan(0);
  });
});
