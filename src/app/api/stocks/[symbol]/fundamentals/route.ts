import { DAILY_CACHE, fail, ok, startTimer } from '@/lib/server/apiResponse';
import { findStock, getFundamentals, getMarketModel } from '@/lib/server/marketData';

/** GET /api/stocks/:symbol/fundamentals — results, annuals and shareholding trend. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const started = startTimer();
  const { symbol } = await context.params;
  const stock = findStock(symbol);
  if (!stock) return fail('NOT_FOUND', `No security with symbol "${symbol}"`, 404, started);
  return ok(getFundamentals(stock), started, {
    meta: { version: getMarketModel().meta.version },
    headers: { 'Cache-Control': DAILY_CACHE },
  });
}
