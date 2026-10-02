import type { NextRequest } from 'next/server';
import { buildHistory, HISTORY_LIMITS, isHistoryInterval } from '@/lib/market/history';
import { fail, ok, startTimer } from '@/lib/server/apiResponse';
import { findStock, getMarketModel } from '@/lib/server/marketData';

/**
 * GET /api/stocks/:symbol/history?interval=1d&limit=500
 *
 * Intervals: 5m (today), 15m (last 5 sessions), 1d (up to ~6 years), 1w.
 * Candle `time` is the bar's open in epoch seconds (UTC).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const started = startTimer();
  const { symbol } = await context.params;
  const stock = findStock(symbol);
  if (!stock) return fail('NOT_FOUND', `No security with symbol "${symbol}"`, 404, started);

  const interval = request.nextUrl.searchParams.get('interval') ?? '1d';
  if (!isHistoryInterval(interval)) {
    return fail('BAD_INTERVAL', 'interval must be one of 5m, 15m, 1d, 1w', 400, started);
  }
  const rawLimit = request.nextUrl.searchParams.get('limit');
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return fail(
      'BAD_LIMIT',
      `limit must be between 1 and ${HISTORY_LIMITS[interval].max}`,
      400,
      started,
    );
  }

  const model = getMarketModel();
  const candles = buildHistory(model, stock.id, interval, limit);
  // Intraday bars depend on the clock; daily and weekly bars are fixed for the day.
  const cache =
    interval === '1d' || interval === '1w' ? 'public, max-age=60, s-maxage=600' : 'no-store';
  return ok({ symbol: stock.symbol, interval, candles }, started, {
    meta: { version: model.meta.version, count: candles.length },
    headers: { 'Cache-Control': cache },
  });
}
