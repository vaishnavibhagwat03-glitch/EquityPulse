import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { generateMarket, type MarketModel } from '../src/lib/mockDataGenerator';
import { MarketEngine } from '../src/lib/priceSimulator';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type Channel,
  type ServerMessage,
} from '../src/lib/feed/protocol';

/**
 * WebSocket market feed server.
 *
 * Generates the same deterministic universe as the Next.js API, runs the live
 * MarketEngine, and streams the feed protocol to every connected client:
 * a snapshot on connect, sequence-numbered tick deltas every `tickIntervalMs`,
 * market aggregates every `marketIntervalMs`, and heartbeats.
 *
 * Backpressure: a client whose socket buffer exceeds `maxBufferedBytes` is
 * skipped for that frame. It will see a sequence gap and request a resync —
 * the same recovery path as a real dropped packet, and it keeps one slow client
 * from growing server memory without bound.
 */

export interface FeedServerOptions {
  port?: number;
  host?: string;
  tickIntervalMs?: number;
  marketIntervalMs?: number;
  heartbeatMs?: number;
  ticksPerSecond?: number;
  maxBufferedBytes?: number;
  /** Supply a pre-built model (tests); otherwise today's universe is generated. */
  model?: MarketModel;
  seed?: number;
  log?: (message: string) => void;
}

export interface FeedServer {
  port: number;
  engine: MarketEngine;
  model: MarketModel;
  clientCount(): number;
  /** Closes every client connection (they will reconnect); the server keeps running. */
  dropAllClients(code?: number): void;
  close(): Promise<void>;
}

interface ClientState {
  channels: Set<Channel>;
  alive: boolean;
  skipped: number;
}

export function createFeedServer(options: FeedServerOptions = {}): Promise<FeedServer> {
  const log = options.log ?? (() => {});
  const tickIntervalMs = options.tickIntervalMs ?? 250;
  const marketIntervalMs = options.marketIntervalMs ?? 1000;
  const heartbeatMs = options.heartbeatMs ?? 5000;
  const maxBuffered = options.maxBufferedBytes ?? 1_000_000;

  const started = Date.now();
  const model = options.model ?? generateMarket();
  log(
    `universe ${model.meta.version}: ${model.stocks.length} instruments in ${Date.now() - started} ms`,
  );
  const engine = new MarketEngine(model.stocks, {
    ticksPerSecond: options.ticksPerSecond ?? 120,
    seed: options.seed,
  });

  const wss = new WebSocketServer({
    port: options.port ?? 4001,
    host: options.host,
    // Snapshots are ~200 KB of JSON; deflate brings them to a fraction of that.
    perMessageDeflate: { threshold: 1024 },
  });
  const clients = new Map<WebSocket, ClientState>();

  const send = (ws: WebSocket, message: ServerMessage | string): void => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  };

  const snapshotFor = (ws: WebSocket): void => {
    send(ws, { type: 'snapshot', seq: engine.sequence, ts: Date.now(), quotes: engine.snapshot() });
  };

  /** Serialises once and fans out to every subscriber with buffer room. */
  const broadcast = (channel: Channel, message: ServerMessage): void => {
    let frame: string | null = null;
    for (const [ws, state] of clients) {
      if (!state.channels.has(channel) || ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > maxBuffered) {
        state.skipped++;
        continue;
      }
      frame ??= JSON.stringify(message);
      ws.send(frame);
    }
  };

  wss.on('connection', ws => {
    const state: ClientState = { channels: new Set(['quotes', 'market']), alive: true, skipped: 0 };
    clients.set(ws, state);
    log(`client connected (${clients.size} total)`);

    send(ws, {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      universe: model.meta.version,
      instruments: engine.size,
      serverTime: Date.now(),
      transport: 'ws',
      tickIntervalMs,
    });
    snapshotFor(ws);
    send(ws, { type: 'market', seq: engine.sequence, ts: Date.now(), market: engine.market() });

    ws.on('pong', () => {
      state.alive = true;
    });
    ws.on('message', data => {
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        send(ws, { type: 'error', code: 'BAD_MESSAGE', message: 'Unrecognised client message' });
        return;
      }
      switch (msg.type) {
        case 'subscribe':
          state.channels = new Set(
            msg.channels.filter((c): c is Channel => c === 'quotes' || c === 'market'),
          );
          break;
        case 'resync':
          snapshotFor(ws);
          break;
        case 'ping':
          send(ws, { type: 'pong', id: msg.id, clientTs: msg.ts, serverTs: Date.now() });
          break;
        case 'rate':
          engine.ticksPerSecond = Math.min(2000, Math.max(5, msg.ticksPerSecond));
          break;
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      log(`client disconnected (${clients.size} remaining)`);
    });
    ws.on('error', () => clients.delete(ws));
  });

  const tickTimer = setInterval(() => {
    const ticks = engine.step(Date.now());
    if (ticks.length)
      broadcast('quotes', { type: 'ticks', seq: engine.sequence, ts: Date.now(), ticks });
  }, tickIntervalMs);

  const marketTimer = setInterval(() => {
    if (clients.size)
      broadcast('market', {
        type: 'market',
        seq: engine.sequence,
        ts: Date.now(),
        market: engine.market(),
      });
  }, marketIntervalMs);

  const heartbeatTimer = setInterval(() => {
    const frame = JSON.stringify({
      type: 'heartbeat',
      seq: engine.sequence,
      ts: Date.now(),
    } satisfies ServerMessage);
    for (const [ws, state] of clients) {
      // Terminate sockets that never answered the previous protocol-level ping.
      if (!state.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      state.alive = false;
      ws.ping();
      send(ws, frame);
    }
  }, heartbeatMs);

  const timers = [tickTimer, marketTimer, heartbeatTimer];

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const port = (wss.address() as AddressInfo).port;
      resolve({
        port,
        engine,
        model,
        clientCount: () => clients.size,
        dropAllClients: (code = 4000) => {
          for (const ws of clients.keys()) ws.close(code, 'server initiated drop');
        },
        close: () =>
          new Promise<void>(done => {
            timers.forEach(clearInterval);
            for (const ws of clients.keys()) ws.terminate();
            clients.clear();
            wss.close(() => done());
          }),
      });
    });
  });
}
