import { gzipSync } from 'node:zlib';
import type { ApiMeta } from '@/types/api';
import type {
  Fundamentals,
  IndexSnapshot,
  MarketOverview,
  SectorSummary,
  Stock,
} from '@/types/market';
import {
  buildOverview,
  generateMarket,
  GENERATOR_VERSION,
  resolveAsOf,
  type MarketModel,
} from '@/lib/mockDataGenerator';
import { buildFundamentals } from '@/lib/market/fundamentals';
import { encodeUniverse } from '@/lib/universeCodec';

/**
 * Server-side market data cache.
 *
 * The universe is generated once per process per IST trading day (~1 s) and
 * everything derived from it — the serialised compact payload, the overview,
 * sector and index summaries — is memoised alongside it. The cache lives on
 * `globalThis` so Next.js dev-mode module reloads don't regenerate it.
 */

interface Cache {
  iso: string;
  model: MarketModel;
  compactJson?: string;
  universeResponse?: UniverseResponse;
  overview?: MarketOverview;
  fundamentals: Map<string, Fundamentals>;
}

const globalCache = globalThis as unknown as { __equitypulseMarket?: Cache };

export function getMarketModel(now = Date.now()): MarketModel {
  // The generator version is part of the key so a code change is never served
  // from a cache built by the previous generator (dev hot reloads keep globals).
  const iso = `${resolveAsOf(undefined, now).iso}:${GENERATOR_VERSION}`;
  const cached = globalCache.__equitypulseMarket;
  if (cached && cached.iso === iso) return cached.model;
  const model = generateMarket({ now });
  globalCache.__equitypulseMarket = { iso, model, fundamentals: new Map() };
  return model;
}

function cache(): Cache {
  getMarketModel();
  return globalCache.__equitypulseMarket!;
}

/** Serialised compact universe; built once, then served as-is. */
export function getCompactUniverseJson(): { body: string; version: string } {
  const c = cache();
  c.compactJson ??= JSON.stringify(encodeUniverse({ meta: c.model.meta, stocks: c.model.stocks }));
  return { body: c.compactJson, version: c.model.meta.version };
}

export interface UniverseResponse {
  version: string;
  /** The complete `ApiResponse` envelope, serialised. */
  json: string;
  /** The same bytes, gzip-compressed (Next.js does not compress route handler responses). */
  gzip: Uint8Array<ArrayBuffer>;
}

/**
 * The `/api/stocks?format=compact` response, built and compressed once per
 * trading day: 1.85 MB of JSON becomes ~0.67 MB on the wire. Its `meta`
 * describes building the payload (when, and how long it took); per-request
 * timing travels in the `X-Execution-Time-Ms` header.
 */
export function getUniverseResponse(): UniverseResponse {
  const c = cache();
  if (!c.universeResponse) {
    const started = performance.now();
    const { body, version } = getCompactUniverseJson();
    const count = c.model.stocks.length;
    const meta: ApiMeta = {
      timestamp: new Date().toISOString(),
      executionTimeMs: Math.round((performance.now() - started) * 1000) / 1000,
      requestId: `universe-${version}`,
      version,
      count,
      total: count,
    };
    const json = `{"success":true,"data":${body},"meta":${JSON.stringify(meta)}}`;
    c.universeResponse = { version, json, gzip: new Uint8Array(gzipSync(json)) };
  }
  return c.universeResponse;
}

export function normaliseSymbol(raw: string): string {
  let symbol = raw;
  try {
    symbol = decodeURIComponent(raw);
  } catch {
    // Keep the raw segment if it is not valid percent-encoding.
  }
  return symbol.trim().toUpperCase();
}

export function findStock(rawSymbol: string): Stock | undefined {
  const model = getMarketModel();
  const id = model.bySymbol.get(normaliseSymbol(rawSymbol));
  return id === undefined ? undefined : model.stocks[id];
}

export function getOverview(): MarketOverview {
  const c = cache();
  c.overview ??= buildOverview(c.model);
  return c.overview;
}

export function getSectors(): SectorSummary[] {
  return getOverview().sectors;
}

export function getIndices(): IndexSnapshot[] {
  const model = getMarketModel();
  return model.indices.map(({ def, members, ...rest }) => ({
    ...def,
    ...rest,
    constituents: members.map(id => ({
      symbol: model.stocks[id]!.symbol,
      shares: model.stocks[id]!.sharesOutstanding,
    })),
  }));
}

export function getFundamentals(stock: Stock): Fundamentals {
  const c = cache();
  let f = c.fundamentals.get(stock.symbol);
  if (!f) {
    f = buildFundamentals(stock, c.model.meta.seed, c.model.asOfDay);
    if (c.fundamentals.size > 500) c.fundamentals.clear();
    c.fundamentals.set(stock.symbol, f);
  }
  return f;
}

/** Same-industry peers by market cap, falling back to the sector. */
export function getPeers(stock: Stock, limit = 6): Stock[] {
  const model = getMarketModel();
  const sameIndustry = model.stocks.filter(
    s => s.industry === stock.industry && s.symbol !== stock.symbol,
  );
  const pool =
    sameIndustry.length >= limit
      ? sameIndustry
      : [
          ...sameIndustry,
          ...model.stocks.filter(s => s.sector === stock.sector && s.industry !== stock.industry),
        ];
  return pool.slice(0, limit);
}
