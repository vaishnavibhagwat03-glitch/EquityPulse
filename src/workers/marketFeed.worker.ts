/**
 * In-browser market feed. Hosts the same MarketEngine as the `ws` server and
 * speaks the same protocol over postMessage, off the main thread.
 */
import { MarketEngine } from '@/lib/priceSimulator';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@/lib/feed/protocol';
import type { WorkerInbound, WorkerOutbound } from '@/lib/feed/transports';

/** The slice of DedicatedWorkerGlobalScope this worker uses (avoids pulling the
 *  webworker lib into the DOM-typed program, where their globals conflict). */
interface FeedWorkerScope {
  onmessage: ((event: MessageEvent<WorkerInbound>) => void) | null;
  postMessage(message: WorkerOutbound): void;
}
const scope = self as unknown as FeedWorkerScope;

let engine: MarketEngine | null = null;
let version = '';
let connected = false;
let tickIntervalMs = 250;
const timers: ReturnType<typeof setInterval>[] = [];

const post = (message: ServerMessage): void => {
  if (connected) scope.postMessage({ kind: 'server', message } satisfies WorkerOutbound);
};

function sendState(): void {
  if (!engine) return;
  post({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    universe: version,
    instruments: engine.size,
    serverTime: Date.now(),
    transport: 'worker',
    tickIntervalMs,
  });
  post({ type: 'snapshot', seq: engine.sequence, ts: Date.now(), quotes: engine.snapshot() });
  post({ type: 'market', seq: engine.sequence, ts: Date.now(), market: engine.market() });
}

function startLoops(): void {
  timers.forEach(clearInterval);
  timers.length = 0;
  timers.push(
    setInterval(() => {
      if (!engine) return;
      // The market keeps moving while disconnected, as a real server's would.
      const ticks = engine.step(Date.now());
      if (ticks.length) post({ type: 'ticks', seq: engine.sequence, ts: Date.now(), ticks });
    }, tickIntervalMs),
    setInterval(() => {
      if (engine && connected)
        post({ type: 'market', seq: engine.sequence, ts: Date.now(), market: engine.market() });
    }, 1000),
    setInterval(() => {
      if (engine) post({ type: 'heartbeat', seq: engine.sequence, ts: Date.now() });
    }, 5000),
  );
}

function handleClient(message: ClientMessage): void {
  if (!engine) return;
  switch (message.type) {
    case 'resync':
      post({ type: 'snapshot', seq: engine.sequence, ts: Date.now(), quotes: engine.snapshot() });
      break;
    case 'ping':
      post({ type: 'pong', id: message.id, clientTs: message.ts, serverTs: Date.now() });
      break;
    case 'rate':
      engine.ticksPerSecond = Math.min(2000, Math.max(5, message.ticksPerSecond));
      break;
    case 'subscribe':
      break;
  }
}

scope.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const data = event.data;
  switch (data.kind) {
    case 'init':
      if (engine && version === data.version) return;
      engine = new MarketEngine(data.instruments, { ticksPerSecond: data.ticksPerSecond ?? 120 });
      version = data.version;
      tickIntervalMs = data.tickIntervalMs ?? 250;
      startLoops();
      scope.postMessage({ kind: 'ready', version } satisfies WorkerOutbound);
      if (connected) sendState();
      break;
    case 'connect':
      connected = true;
      sendState();
      break;
    case 'disconnect':
      connected = false;
      break;
    case 'client':
      handleClient(data.message);
      break;
  }
};
