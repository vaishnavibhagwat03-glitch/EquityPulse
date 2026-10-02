import type { NextRequest } from 'next/server';
import { fail, ok, startTimer } from '@/lib/server/apiResponse';
import { getIndices, getMarketModel } from '@/lib/server/marketData';

/**
 * GET /api/indices[?id=NIFTY50] — index levels at the snapshot with intraday
 * path, 60-session history and constituents (fixed-share weights).
 */
export function GET(request: NextRequest): Response {
  const started = startTimer();
  const id = request.nextUrl.searchParams.get('id')?.toUpperCase();
  const indices = getIndices();
  const data = id ? indices.filter(i => i.id === id) : indices;
  if (id && !data.length) return fail('NOT_FOUND', `No index with id "${id}"`, 404, started);
  return ok(data, started, {
    meta: { count: data.length, version: getMarketModel().meta.version },
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120' },
  });
}
