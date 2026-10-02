import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiResponse } from '@/types/api';
import type { Group } from '@/types/filters';
import { GET as getDefinitions } from '@/app/api/filters/definitions/route';
import { GET as getPresets, POST as postPreset } from '@/app/api/filters/presets/route';
import { GET as getHealth } from '@/app/api/health/route';
import { GET as getIndices } from '@/app/api/indices/route';
import { GET as getMarket } from '@/app/api/market/route';
import { POST as postScreen } from '@/app/api/screen/route';
import { GET as getSectors } from '@/app/api/sectors/route';
import { GET as getFundamentals } from '@/app/api/stocks/[symbol]/fundamentals/route';
import { GET as getHistory } from '@/app/api/stocks/[symbol]/history/route';
import { GET as getStock } from '@/app/api/stocks/[symbol]/route';
import { GET as getStocks } from '@/app/api/stocks/route';
import { FilterEngine } from '@/lib/filterEngine';
import { buildColumnStore } from '@/lib/filters/columnStore';
import { panelToExpression } from '@/lib/filters/panel';
import { panelFromPreset, PRESET_BY_ID } from '@/lib/filters/presets';
import { getMarketModel } from '@/lib/server/marketData';
import { decodeUniverse, type CompactUniverse } from '@/lib/universeCodec';

/**
 * The mock API, called through its real route handlers. Every response uses
 * the same envelope: { success, data, meta: { timestamp, executionTimeMs,
 * requestId, … }, error? }.
 */

const req = (path: string, init?: RequestInit): NextRequest =>
  new NextRequest(`http://localhost${path}`, init as never);
const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

async function read<T>(response: Response): Promise<ApiResponse<T>> {
  const body = (await response.json()) as ApiResponse<T>;
  expect(typeof body.meta.timestamp).toBe('string');
  expect(body.meta.executionTimeMs).toBeGreaterThanOrEqual(0);
  expect(body.meta.requestId).toBeTruthy();
  return body;
}

const model = getMarketModel();

describe('GET /api/stocks', () => {
  it('serves the whole universe in the compact format, with an ETag', async () => {
    const res = getStocks(req('/api/stocks?format=compact'));
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    expect(etag).toBe(`"${model.meta.version}"`);
    const body = await read<CompactUniverse>(res);
    expect(body.success).toBe(true);
    expect(decodeUniverse(body.data!).stocks).toHaveLength(model.stocks.length);

    const cached = getStocks(
      req('/api/stocks?format=compact', { headers: { 'if-none-match': etag } }),
    );
    expect(cached.status).toBe(304);
  });

  it('sends the universe gzipped to clients that accept it', async () => {
    const plain = await getStocks(req('/api/stocks?format=compact')).text();
    const res = getStocks(
      req('/api/stocks?format=compact', { headers: { 'accept-encoding': 'gzip, deflate, br' } }),
    );
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    const compressed = Buffer.from(await res.arrayBuffer());
    expect(gunzipSync(compressed).toString('utf8')).toBe(plain);
    expect(compressed.length).toBeLessThan(plain.length / 2);
  });

  it('paginates, filters, sorts and projects full records', async () => {
    const res = getStocks(
      req('/api/stocks?sector=banking&sort=marketCap&order=desc&limit=5&offset=0&fields=price,pe'),
    );
    const body = await read<Record<string, unknown>[]>(res);
    expect(body.data).toHaveLength(5);
    expect(body.meta.total).toBe(model.stocks.filter(s => s.sector === 'Banking').length);
    expect(Object.keys(body.data![0]!).sort()).toEqual(['pe', 'price', 'symbol']);

    const sorted = await read<{ pe: number | null }[]>(
      getStocks(req('/api/stocks?sort=pe&order=asc&limit=50')),
    );
    const pes = sorted.data!.map(s => s.pe!);
    expect(pes).toEqual([...pes].sort((a, b) => a - b));

    const search = await read<{ symbol: string }[]>(getStocks(req('/api/stocks?q=reliance')));
    expect(search.data!.map(s => s.symbol)).toContain('RELIANCE');
  });

  it('rejects unknown formats and unsortable fields', async () => {
    const bad = await read<never>(getStocks(req('/api/stocks?format=xml')));
    expect(bad.success).toBe(false);
    expect(bad.error!.code).toBe('BAD_FORMAT');
    expect(getStocks(req('/api/stocks?sort=__proto__')).status).toBe(400);
  });
});

describe('GET /api/stocks/:symbol and its history and fundamentals', () => {
  it('returns one security with its industry peers, case-insensitively', async () => {
    const body = await read<{
      stock: { symbol: string; industry: string };
      peers: { symbol: string }[];
    }>(await getStock(req('/api/stocks/reliance'), params('reliance')));
    expect(body.data!.stock.symbol).toBe('RELIANCE');
    expect(body.data!.peers.length).toBeGreaterThan(0);
    expect(body.data!.peers.map(p => p.symbol)).not.toContain('RELIANCE');
    const missing = await getStock(req('/api/stocks/NOPE'), params('NOPE'));
    expect(missing.status).toBe(404);
  });

  it('serves 252+ daily candles and validates interval and limit', async () => {
    const res = await getHistory(
      req('/api/stocks/TCS/history?interval=1d&limit=300'),
      params('TCS'),
    );
    const body = await read<{ candles: unknown[] }>(res);
    expect(body.data!.candles.length).toBe(300);
    expect(
      (await getHistory(req('/api/stocks/TCS/history?interval=1h'), params('TCS'))).status,
    ).toBe(400);
    expect(
      (await getHistory(req('/api/stocks/TCS/history?interval=1d&limit=0'), params('TCS'))).status,
    ).toBe(400);
    expect((await getHistory(req('/api/stocks/NOPE/history'), params('NOPE'))).status).toBe(404);
  });

  it('serves fundamentals', async () => {
    const body = await read<{ symbol: string; quarterly: unknown[]; shareholding: unknown[] }>(
      await getFundamentals(req('/api/stocks/INFY/fundamentals'), params('INFY')),
    );
    expect(body.data!.symbol).toBe('INFY');
    expect(body.data!.quarterly.length).toBeGreaterThan(0);
    expect(body.data!.shareholding.length).toBeGreaterThan(0);
    expect(
      (await getFundamentals(req('/api/stocks/NOPE/fundamentals'), params('NOPE'))).status,
    ).toBe(404);
  });
});

describe('market endpoints', () => {
  it('GET /api/sectors, /api/indices and /api/market', async () => {
    const sectors = await read<{ name: string; count: number }[]>(getSectors());
    expect(sectors.data!.reduce((n, s) => n + s.count, 0)).toBe(model.stocks.length);

    const indices = await read<{ id: string; constituents: unknown[] }[]>(
      getIndices(req('/api/indices')),
    );
    expect(indices.data!.map(i => i.id)).toEqual(
      expect.arrayContaining(['NIFTY50', 'SENSEX', 'BANKNIFTY', 'NIFTYIT']),
    );
    const nifty = await read<{ id: string; constituents: unknown[] }[]>(
      getIndices(req('/api/indices?id=nifty50')),
    );
    expect(nifty.data![0]!.constituents).toHaveLength(50);
    expect(getIndices(req('/api/indices?id=NOPE')).status).toBe(404);

    const market = await read<{ breadth: { total: number } }>(getMarket());
    expect(market.data!.breadth.total).toBe(model.stocks.length);

    const health = (await getHealth().json()) as ApiResponse<{
      status: string;
      instruments: number;
    }>;
    expect(health.data).toMatchObject({ status: 'ok', instruments: model.stocks.length });
  });
});

describe('filters', () => {
  it('GET /api/filters/definitions lists the 30+ criteria', async () => {
    const body = await read<{ filters: unknown[] }>(getDefinitions());
    expect(body.data!.filters.length).toBeGreaterThanOrEqual(30);
  });

  it('POST /api/filters/presets saves a valid screen and lists it', async () => {
    const res = await postPreset(
      req(
        '/api/filters/presets',
        json({
          name: 'Cheap banks',
          panel: {
            values: {
              pe: { type: 'range', max: 12 },
              sector: { type: 'multiselect', values: ['Banking'] },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(201);
    const saved = await read<{ id: string; criteria: string[]; builtIn: boolean }>(res);
    expect(saved.data!.builtIn).toBe(false);
    expect(saved.data!.criteria).toEqual(['P/E ≤ 12', 'Sector: Banking']);

    const list = await read<{ id: string }[]>(getPresets());
    expect(list.data!.map(p => p.id)).toEqual(expect.arrayContaining(['value', saved.data!.id]));
  });

  it('POST /api/filters/presets rejects bad JSON, bad shapes and unknown filters', async () => {
    const badJson = await postPreset(
      req('/api/filters/presets', { method: 'POST', body: '{nope' }),
    );
    expect(badJson.status).toBe(400);
    expect((await read<never>(badJson)).error!.code).toBe('BAD_JSON');

    const noName = await postPreset(req('/api/filters/presets', json({ panel: { values: {} } })));
    expect(noName.status).toBe(422);

    const unknown = await read<never>(
      await postPreset(
        req(
          '/api/filters/presets',
          json({ name: 'x', panel: { values: { madeUp: { type: 'range', min: 1 } } } }),
        ),
      ),
    );
    expect(unknown.error!.details).toEqual(['Unknown filter "madeUp"']);

    const wrongType = await read<never>(
      await postPreset(
        req(
          '/api/filters/presets',
          json({ name: 'x', panel: { values: { pe: { type: 'boolean', value: true } } } }),
        ),
      ),
    );
    expect(wrongType.error!.details).toEqual(['Filter "pe" expects a range value, got boolean']);
  });

  it('POST /api/screen runs the same engine as the client', async () => {
    const preset = PRESET_BY_ID.get('value')!;
    const res = await postScreen(req('/api/screen', json({ panel: preset.panel, limit: 10 })));
    const body = await read<{
      stats: { matched: number };
      matches: { symbol: string }[];
      expression: string;
    }>(res);
    const client = new FilterEngine(buildColumnStore(model.stocks, model.meta.version)).screen(
      panelToExpression(panelFromPreset(preset)),
    );
    expect(body.data!.stats.matched).toBe(client.stats.matched);
    expect(body.data!.matches.length).toBe(Math.min(10, client.stats.matched));
    expect(body.data!.expression).toContain('P/E < 15');
  });

  it('POST /api/screen accepts raw expressions and refuses runaway ones', async () => {
    const ok = await read<{ stats: { matched: number } }>(
      await postScreen(
        req(
          '/api/screen',
          json({ expression: { kind: 'condition', id: 'a', field: 'roe', op: 'gt', value: 20 } }),
        ),
      ),
    );
    expect(ok.data!.stats.matched).toBe(model.stocks.filter(s => s.roe > 20).length);

    let deep: Group = {
      kind: 'group',
      id: 'g0',
      combinator: 'AND',
      children: [{ kind: 'condition', id: 'c', field: 'roe', op: 'gt', value: 1 }],
    };
    for (let i = 1; i < 10; i++)
      deep = { kind: 'group', id: `g${i}`, combinator: 'AND', children: [deep] };
    const tooDeep = await postScreen(req('/api/screen', json({ expression: deep })));
    expect(tooDeep.status).toBe(422);

    const badField = await postScreen(
      req(
        '/api/screen',
        json({ expression: { kind: 'condition', id: 'a', field: 'nope', op: 'gt', value: 1 } }),
      ),
    );
    expect(badField.status).toBe(422);
    expect((await postScreen(req('/api/screen', { method: 'POST', body: 'x' }))).status).toBe(400);
  });
});
