import type { EngineInstrument } from '@/lib/priceSimulator';
import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type TransportKind,
} from './protocol';

/**
 * Feed transports. The FeedClient's state machine, backoff and sequence
 * handling are transport-agnostic; a transport only moves protocol messages.
 */

export interface TransportHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onClose(reason: string): void;
}

export interface FeedTransport {
  readonly kind: TransportKind;
  connect(handlers: TransportHandlers): void;
  send(message: ClientMessage): void;
  /** Closes without notifying `onClose` (the caller already knows). */
  close(): void;
}

type SocketCtor = new (url: string) => WebSocket;

/** Real WebSocket to the `ws` feed server. */
export class WebSocketTransport implements FeedTransport {
  readonly kind = 'ws' as const;
  private socket: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly Socket: SocketCtor = WebSocket,
  ) {}

  connect(handlers: TransportHandlers): void {
    const socket = new this.Socket(this.url);
    this.socket = socket;
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = event => {
      const message = parseServerMessage(event.data);
      if (message) handlers.onMessage(message);
    };
    socket.onclose = event => {
      this.socket = null;
      handlers.onClose(event.reason || `socket closed (${event.code})`);
    };
    // An error is always followed by a close event; handle it there.
    socket.onerror = () => {};
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(1000, 'client closed');
    } catch {
      // Closing a socket that never opened can throw in some browsers.
    }
  }
}

/* ------------------------------------------------------------------------ */
/* In-browser feed (Web Worker)                                             */
/* ------------------------------------------------------------------------ */

export type WorkerInbound =
  | {
      kind: 'init';
      instruments: EngineInstrument[];
      version: string;
      ticksPerSecond?: number;
      tickIntervalMs?: number;
    }
  | { kind: 'connect' }
  | { kind: 'disconnect' }
  | { kind: 'client'; message: ClientMessage };

export type WorkerOutbound =
  { kind: 'server'; message: ServerMessage } | { kind: 'ready'; version: string };

/**
 * Speaks the same protocol to a MarketEngine running in a Web Worker, so
 * deployments without a socket server (static hosting, Vercel) still stream.
 * The worker keeps simulating while "disconnected", exactly like a server
 * would; reconnecting delivers a fresh snapshot.
 */
export class WorkerTransport implements FeedTransport {
  readonly kind = 'worker' as const;
  private handlers: TransportHandlers | null = null;
  private listener: ((event: MessageEvent<WorkerOutbound>) => void) | null = null;

  constructor(private readonly worker: Worker) {}

  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
    this.listener = event => {
      if (event.data.kind === 'server') {
        const message = parseServerMessage(event.data.message);
        if (message) this.handlers?.onMessage(message);
      }
    };
    this.worker.addEventListener('message', this.listener);
    this.worker.postMessage({ kind: 'connect' } satisfies WorkerInbound);
    queueMicrotask(() => this.handlers?.onOpen());
  }

  send(message: ClientMessage): void {
    this.worker.postMessage({ kind: 'client', message } satisfies WorkerInbound);
  }

  close(): void {
    if (this.listener) this.worker.removeEventListener('message', this.listener);
    this.listener = null;
    this.handlers = null;
    this.worker.postMessage({ kind: 'disconnect' } satisfies WorkerInbound);
  }
}
