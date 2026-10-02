import type { NextRequest } from 'next/server';
import type { Stock } from '@/types/market';
import { FIELD_META } from '@/lib/filters/fields';
import { DAILY_CACHE, fail, meta, ok, startTimer } from '@/lib/server/apiResponse';
import { getMarketModel, getUniverseResponse } from '@/lib/server/marketData';

/**
 * GET /api/stocks
 *
 *   ?format=compact   the whole universe in the columnar wire format (what the
 *                     app loads; ~1.8 MB raw, ~0.6–0.7 MB compressed). ETag'd.
 *   ?format=full      paginated Stock objects (default), with:
 *                     q, sector, exchange, category (comma lists), sort, order,
 *                     limit (1–1000, default 100), offset, fields (projection)
 */
export function GET(request: NextRequest): Response {
  const started = startTimer();
  const params = request.nextUrl.searchParams;
  const format = params.get('format') ?? 'full';
  const model = getMarketModel();
  const version = model.meta.version;

  if (format === 'compact') {
    const etag = `"${version}"`;
    const headers = { ETag: etag, 'Cache-Control': DAILY_CACHE, Vary: 'Accept-Encoding' };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    // Serialised and gzipped once per day (see getUniverseResponse).
    const universe = getUniverseResponse();
    const gzip = /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '');
    return new Response(gzip ? universe.gzip : universe.json, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        ...(gzip ? { 'Content-Encoding': 'gzip' } : null),
        'X-Execution-Time-Ms': String(meta(started).executionTimeMs),
      },
    });
  }
  if (format !== 'full')
    return fail('BAD_FORMAT', 'format must be "compact" or "full"', 400, started);

  const list = (key: string): string[] =>
    (params.get(key) ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  const sectors = list('sector');
  const exchanges = list('exchange');
  const categories = list('category');
  const q = params.get('q')?.trim().toLowerCase();

  let rows: Stock[] = model.stocks;
  if (sectors.length) rows = rows.filter(s => sectors.includes(s.sector.toLowerCase()));
  if (exchanges.length) rows = rows.filter(s => exchanges.includes(s.exchange.toLowerCase()));
  if (categories.length)
    rows = rows.filter(s => categories.includes(s.marketCapCategory.toLowerCase()));
  if (q)
    rows = rows.filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));

  const sort = params.get('sort');
  if (sort) {
    const kind = FIELD_META.get(sort)?.kind;
    if (sort !== 'symbol' && sort !== 'name' && kind !== 'number' && kind !== 'category') {
      return fail('BAD_SORT', `Cannot sort by "${sort}"`, 400, started);
    }
    const dir = params.get('order') === 'asc' ? 1 : -1;
    const key = sort as keyof Stock;
    rows = [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  const limit = Math.min(1000, Math.max(1, Number(params.get('limit') ?? 100) || 100));
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0);
  const page = rows.slice(offset, offset + limit);

  const fields = list('fields');
  const data = fields.length
    ? page.map(s => {
        const picked: Record<string, unknown> = { symbol: s.symbol };
        for (const f of Object.keys(s))
          if (fields.includes(f.toLowerCase())) picked[f] = s[f as keyof Stock];
        return picked;
      })
    : page;

  return ok(data, started, {
    meta: { version, count: page.length, total: rows.length, limit, offset },
    headers: { 'Cache-Control': DAILY_CACHE },
  });
}
