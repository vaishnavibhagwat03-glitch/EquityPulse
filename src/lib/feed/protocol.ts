import type { MarketBreadth, MarketMovers } from '@/types/market';

/**
 * Market feed wire protocol (v1). Spoken identically by the `ws` feed server
 * and the in-browser worker feed; only the framing differs (JSON text over a
 * socket vs. structured-clone messages).
 *
 *   server → client
 *     hello      once per connection: protocol, universe version, cadence
 *     snapshot   full state of every instrument (on connect and on resync)
 *     ticks      deltas since the previous message, sequence-numbered
 *     market     whole-market aggregates, ~1 per second
 *     heartbeat  liveness when nothing else is flowing
 *     pong       reply to ping, for round-trip measurement
 *
 *   client → server
 *     subscribe  choose channels
 *     resync     request a fresh snapshot (sent after a sequence gap)
 *     ping       round-trip probe
 *     rate       change tick throughput (demo control)
 *
 * Ticks carry the instrument's position in the snapshot, not its symbol, to
 * keep a delta at ~20 bytes.
 */

export const PROTOCOL_VERSION = 1;

/** [symbol, price, dayHigh, dayLow, volume, previousClose] */
export type QuoteTuple = [string, number, number, number, number, number];
/** [snapshot position, price, volume] */
export type TickTuple = [number, number, number];

export type Channel = 'quotes' | 'market';
export type TransportKind = 'ws' | 'worker';

export interface LiveIndex {
  id: string;
  value: number;
  change: number;
  changePercent: number;
  advancing: number;
  declining: number;
}

export interface LiveSector {
  name: string;
  changePercent: number;
  advancing: number;
  declining: number;
}

export interface LiveMarket {
  breadth: MarketBreadth;
  indices: LiveIndex[];
  sectors: LiveSector[];
  movers: MarketMovers;
  distribution: number[];
}

export type ServerMessage =
  | {
      type: 'hello';
      protocol: number;
      universe: string;
      instruments: number;
      serverTime: number;
      transport: TransportKind;
      tickIntervalMs: number;
    }
  | { type: 'snapshot'; seq: number; ts: number; quotes: QuoteTuple[] }
  | { type: 'ticks'; seq: number; ts: number; ticks: TickTuple[] }
  | { type: 'market'; seq: number; ts: number; market: LiveMarket }
  | { type: 'heartbeat'; seq: number; ts: number }
  | { type: 'pong'; id: number; clientTs: number; serverTs: number }
  | { type: 'error'; code: string; message: string };

export type ClientMessage =
  | { type: 'subscribe'; channels: Channel[] }
  | { type: 'resync' }
  | { type: 'ping'; id: number; ts: number }
  | { type: 'rate'; ticksPerSecond: number };

const SERVER_TYPES = new Set([
  'hello',
  'snapshot',
  'ticks',
  'market',
  'heartbeat',
  'pong',
  'error',
]);
const CLIENT_TYPES = new Set(['subscribe', 'resync', 'ping', 'rate']);

function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validates the envelope; malformed frames return null and are dropped. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const msg = parse(raw);
  if (!msg || typeof msg.type !== 'string' || !SERVER_TYPES.has(msg.type)) return null;
  if (msg.type === 'ticks' && (!Array.isArray(msg.ticks) || typeof msg.seq !== 'number'))
    return null;
  if (msg.type === 'snapshot' && (!Array.isArray(msg.quotes) || typeof msg.seq !== 'number'))
    return null;
  return msg as unknown as ServerMessage;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const msg = parse(raw);
  if (!msg || typeof msg.type !== 'string' || !CLIENT_TYPES.has(msg.type)) return null;
  if (
    msg.type === 'rate' &&
    (typeof msg.ticksPerSecond !== 'number' || !Number.isFinite(msg.ticksPerSecond))
  ) {
    return null;
  }
  if (msg.type === 'subscribe' && !Array.isArray(msg.channels)) return null;
  return msg as unknown as ClientMessage;
}
