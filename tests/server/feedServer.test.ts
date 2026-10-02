import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createFeedServer, type FeedServer } from '../../server/feedServer';
import { FeedClient, type FeedStatus, type TickUpdate } from '@/lib/feed/client';
import type { LiveMarket, QuoteTuple, ServerMessage } from '@/lib/feed/protocol';
import { WebSocketTransport } from '@/lib/feed/transports';
import { market } from '../fixtures/market';

/**
 * End to end over a real socket: the production feed server and the
 * production client + WebSocket transport, speaking the wire protocol.
 */

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise(r => setTimeout(r, 10));
  }
}

let server: FeedServer;

beforeAll(async () => {
  server = await createFeedServer({
    port: 0,
    host: '127.0.0.1',
    model: market(300),
    seed: 11,
    tickIntervalMs: 40,
    marketIntervalMs: 100,
    heartbeatMs: 2000,
    ticksPerSecond: 300,
  });
});

afterAll(async () => {
  await server.close();
});

function connectClient() {
  const statuses: FeedStatus[] = [];
  const snapshots: QuoteTuple[][] = [];
  const ticks: TickUpdate[] = [];
  const markets: LiveMarket[] = [];
  const rtts: number[] = [];
  let hello: { universe: string; instruments: number } | null = null;
  const client = new FeedClient({
    createTransport: () => new WebSocketTransport(`ws://127.0.0.1:${server.port}`),
    onStatus: s => statuses.push(s),
    onHello: info => (hello = info),
    onSnapshot: quotes => snapshots.push(quotes),
    onTicks: updates => ticks.push(...updates),
    onMarket: m => markets.push(m),
    onRtt: ms => rtts.push(ms),
    baseMs: 50,
    maxMs: 200,
    pingIntervalMs: 200,
    isOnline: () => true,
  });
  client.start();
  return { client, statuses, snapshots, ticks, markets, rtts, hello: () => hello };
}

describe('feed server ↔ feed client', () => {
  it('greets, snapshots the universe and goes live', async () => {
    const c = connectClient();
    await until(() => c.client.status === 'live');
    expect(c.hello()).toEqual({
      universe: server.model.meta.version,
      transport: 'ws',
      instruments: 300,
    });
    expect(c.snapshots[0]).toHaveLength(300);
    expect(c.snapshots[0]![0]![0]).toBe(server.model.stocks[0]!.symbol);
    expect(server.clientCount()).toBe(1);
    c.client.stop();
    await until(() => server.clientCount() === 0);
  });

  it('streams sequenced tick deltas and market aggregates without gaps', async () => {
    const c = connectClient();
    await until(() => c.ticks.length > 200 && c.markets.length >= 3);
    expect(c.client.metrics.gaps).toBe(0);
    const symbols = new Set(server.model.stocks.map(s => s.symbol));
    for (const t of c.ticks.slice(0, 50)) {
      expect(symbols.has(t.symbol)).toBe(true);
      expect(t.price).toBeGreaterThan(0);
    }
    expect(c.markets.at(-1)!.breadth.total).toBe(300);
    c.client.stop();
  });

  it('answers pings (round-trip time) and resync requests', async () => {
    const c = connectClient();
    await until(() => c.client.status === 'live' && c.rtts.length > 0);
    expect(c.rtts[0]).toBeGreaterThanOrEqual(0);
    c.client.send({ type: 'resync' });
    await until(() => c.snapshots.length >= 2);
    expect(c.snapshots[1]).toHaveLength(300);
    c.client.stop();
  });

  it('recovers on its own when the server drops every connection', async () => {
    const c = connectClient();
    await until(() => c.client.status === 'live');
    const before = c.snapshots.length;
    server.dropAllClients();
    await until(() => c.statuses.includes('reconnecting'));
    await until(() => c.client.status === 'live' && c.snapshots.length > before);
    expect(c.client.metrics.reconnects).toBeGreaterThanOrEqual(1);
    c.client.stop();
  });

  it('rejects malformed client messages with an error frame', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const frames: ServerMessage[] = [];
    socket.on('message', data => frames.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>(resolve => socket.once('open', () => resolve()));
    socket.send('not even json');
    await until(() => frames.some(f => f.type === 'error'));
    expect(frames.find(f => f.type === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    // Unsubscribing from quotes stops tick frames for this socket.
    socket.send(JSON.stringify({ type: 'subscribe', channels: ['market'] }));
    await new Promise(r => setTimeout(r, 100));
    const seen = frames.length;
    await new Promise(r => setTimeout(r, 300));
    expect(frames.slice(seen).some(f => f.type === 'ticks')).toBe(false);
    expect(frames.slice(seen).some(f => f.type === 'market')).toBe(true);
    socket.close();
  });
});
