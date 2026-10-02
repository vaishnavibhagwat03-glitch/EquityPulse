import type { FeedTransport } from './transports';
import type { LiveMarket, QuoteTuple, ServerMessage, TransportKind } from './protocol';

/**
 * Market feed client: the connection state machine.
 *
 *   idle ─start→ connecting ─snapshot→ live
 *                    ▲                  │ transport closed / heartbeat lost
 *                    │                  ▼
 *                    └─ backoff ── reconnecting ── (attempts exhausted) → offline
 *   offline ─browser online / retryNow()→ connecting
 *
 * - Backoff: exponential from `baseMs`, capped at `maxMs`, with jitter so a
 *   server restart is not met by every client at the same instant.
 * - Watchdog: no message for `heartbeatTimeoutMs` means the link is dead even
 *   if the socket has not noticed; it is closed and reconnected.
 * - Sequence gaps trigger a `resync` request; ticks carry absolute values, so
 *   applying what did arrive is always safe while the snapshot is in flight.
 * - Existing data is never cleared on disconnect: the UI keeps showing the
 *   last known prices and marks the connection state.
 */

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface TickUpdate {
  symbol: string;
  price: number;
  volume: number;
  ts: number;
  rx: number;
}

export interface Timers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface FeedClientOptions {
  createTransport(): FeedTransport;
  onStatus?(
    status: FeedStatus,
    info: { attempt: number; nextRetryAt: number | null; reason?: string },
  ): void;
  onHello?(info: { universe: string; transport: TransportKind; instruments: number }): void;
  onSnapshot?(quotes: QuoteTuple[], ts: number): void;
  onTicks?(updates: TickUpdate[]): void;
  onMarket?(market: LiveMarket, ts: number): void;
  onRtt?(ms: number): void;
  baseMs?: number;
  maxMs?: number;
  maxAttempts?: number;
  heartbeatTimeoutMs?: number;
  pingIntervalMs?: number;
  isOnline?(): boolean;
  random?(): number;
  now?(): number;
  timers?: Timers;
}

const defaultTimers: Timers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};

export interface FeedMetrics {
  messages: number;
  ticks: number;
  gaps: number;
  resyncs: number;
  reconnects: number;
  lastMessageAt: number | null;
  rttMs: number | null;
  connectedAt: number | null;
}

export class FeedClient {
  status: FeedStatus = 'idle';
  attempt = 0;
  readonly metrics: FeedMetrics = {
    messages: 0,
    ticks: 0,
    gaps: 0,
    resyncs: 0,
    reconnects: 0,
    lastMessageAt: null,
    rttMs: null,
    connectedAt: null,
  };

  private transport: FeedTransport | null = null;
  private stopped = true;
  private lastSeq = -1;
  private positions: string[] = [];
  private retryTimer: unknown = null;
  private watchdogTimer: unknown = null;
  private pingTimer: unknown = null;
  private pingId = 0;
  private readonly o: Required<
    Pick<
      FeedClientOptions,
      'baseMs' | 'maxMs' | 'maxAttempts' | 'heartbeatTimeoutMs' | 'pingIntervalMs'
    >
  > & { timers: Timers; now: () => number; random: () => number; isOnline: () => boolean };

  constructor(private readonly options: FeedClientOptions) {
    this.o = {
      baseMs: options.baseMs ?? 800,
      maxMs: options.maxMs ?? 15_000,
      maxAttempts: options.maxAttempts ?? 8,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 12_000,
      pingIntervalMs: options.pingIntervalMs ?? 10_000,
      timers: options.timers ?? defaultTimers,
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      // Only an explicit `false` means offline: runtimes without the flag
      // (Node 21+ has a `navigator` with no `onLine`) must not read as offline.
      isOnline:
        options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false),
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.transport?.close();
    this.transport = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.setStatus('idle');
  }

  /** Reconnect immediately, resetting the backoff (manual retry). */
  retryNow(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.transport?.close();
    this.transport = null;
    this.attempt = 0;
    this.open();
  }

  /** Severs the link as a network failure would — used to demonstrate recovery. */
  simulateDrop(): void {
    if (!this.transport) return;
    this.transport.close();
    this.handleClose('simulated network interruption');
  }

  send(message: Parameters<FeedTransport['send']>[0]): void {
    this.transport?.send(message);
  }

  private setStatus(status: FeedStatus, reason?: string, nextRetryAt: number | null = null): void {
    this.status = status;
    this.options.onStatus?.(status, { attempt: this.attempt, nextRetryAt, reason });
  }

  private open(): void {
    if (this.stopped) return;
    if (!this.o.isOnline()) {
      this.setStatus('offline', 'browser is offline');
      return;
    }
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const transport = this.options.createTransport();
    this.transport = transport;
    this.lastSeq = -1;
    transport.connect({
      onOpen: () => {
        if (this.transport !== transport) return;
        transport.send({ type: 'subscribe', channels: ['quotes', 'market'] });
        this.armWatchdog();
        this.startPing();
      },
      onMessage: message => {
        if (this.transport === transport) this.handleMessage(message);
      },
      onClose: reason => {
        if (this.transport === transport) this.handleClose(reason);
      },
    });
  }

  private handleMessage(message: ServerMessage): void {
    const rx = typeof performance !== 'undefined' ? performance.now() : 0;
    this.metrics.messages++;
    this.metrics.lastMessageAt = this.o.now();
    this.armWatchdog();

    switch (message.type) {
      case 'hello':
        this.options.onHello?.({
          universe: message.universe,
          transport: message.transport,
          instruments: message.instruments,
        });
        break;
      case 'snapshot':
        this.positions = message.quotes.map(q => q[0]);
        this.lastSeq = message.seq;
        this.options.onSnapshot?.(message.quotes, message.ts);
        if (this.status !== 'live') {
          this.attempt = 0;
          this.metrics.connectedAt = this.o.now();
          this.setStatus('live');
        }
        break;
      case 'ticks': {
        if (this.lastSeq >= 0 && message.seq !== this.lastSeq + 1) {
          this.metrics.gaps++;
          this.metrics.resyncs++;
          this.transport?.send({ type: 'resync' });
        }
        this.lastSeq = message.seq;
        const updates: TickUpdate[] = [];
        for (const [position, price, volume] of message.ticks) {
          const symbol = this.positions[position];
          if (symbol) updates.push({ symbol, price, volume, ts: message.ts, rx });
        }
        this.metrics.ticks += updates.length;
        if (updates.length) this.options.onTicks?.(updates);
        break;
      }
      case 'market':
        this.options.onMarket?.(message.market, message.ts);
        break;
      case 'pong': {
        const rtt = this.o.now() - message.clientTs;
        this.metrics.rttMs = rtt;
        this.options.onRtt?.(rtt);
        break;
      }
      case 'heartbeat':
      case 'error':
        break;
    }
  }

  private handleClose(reason: string): void {
    this.clearTimers();
    this.transport = null;
    if (this.stopped) return;
    if (!this.o.isOnline()) {
      this.setStatus('offline', 'browser is offline');
      return;
    }
    this.scheduleReconnect(reason);
  }

  private scheduleReconnect(reason: string): void {
    this.attempt++;
    this.metrics.reconnects++;
    if (this.attempt > this.o.maxAttempts) {
      this.setStatus('offline', `gave up after ${this.o.maxAttempts} attempts (${reason})`);
      return;
    }
    const exp = Math.min(this.o.maxMs, this.o.baseMs * 2 ** (this.attempt - 1));
    // Equal jitter: at least half the delay, at most all of it.
    const delay = Math.round(exp / 2 + (exp / 2) * this.o.random());
    this.setStatus('reconnecting', reason, this.o.now() + delay);
    this.retryTimer = this.o.timers.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private armWatchdog(): void {
    if (this.watchdogTimer !== null) this.o.timers.clearTimeout(this.watchdogTimer);
    this.watchdogTimer = this.o.timers.setTimeout(() => {
      this.watchdogTimer = null;
      if (!this.transport) return;
      this.transport.close();
      this.handleClose('no data within the heartbeat window');
    }, this.o.heartbeatTimeoutMs);
  }

  private startPing(): void {
    if (this.pingTimer !== null) this.o.timers.clearInterval(this.pingTimer);
    const ping = (): void =>
      this.transport?.send({ type: 'ping', id: ++this.pingId, ts: this.o.now() });
    ping();
    this.pingTimer = this.o.timers.setInterval(ping, this.o.pingIntervalMs);
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) this.o.timers.clearTimeout(this.retryTimer);
    if (this.watchdogTimer !== null) this.o.timers.clearTimeout(this.watchdogTimer);
    if (this.pingTimer !== null) this.o.timers.clearInterval(this.pingTimer);
    this.retryTimer = this.watchdogTimer = this.pingTimer = null;
  }

  private handleOnline = (): void => {
    if (this.stopped) return;
    if (this.status === 'offline' || this.status === 'reconnecting') this.retryNow();
  };

  private handleOffline = (): void => {
    if (this.stopped || !this.transport) {
      if (!this.stopped) this.setStatus('offline', 'browser is offline');
      return;
    }
    this.clearTimers();
    this.transport.close();
    this.transport = null;
    this.setStatus('offline', 'browser is offline');
  };
}
