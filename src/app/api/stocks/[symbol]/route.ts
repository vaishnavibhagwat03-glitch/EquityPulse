import { DAILY_CACHE, fail, ok, startTimer } from '@/lib/server/apiResponse';
import { findStock, getMarketModel, getPeers } from '@/lib/server/marketData';

/** GET /api/stocks/:symbol — the full record plus same-industry peers. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const started = startTimer();
  const { symbol } = await context.params;
  const stock = findStock(symbol);
  if (!stock) return fail('NOT_FOUND', `No security with symbol "${symbol}"`, 404, started);

  const peers = getPeers(stock).map(p => ({
    symbol: p.symbol,
    name: p.name,
    price: p.price,
    changePercent: p.changePercent,
    marketCap: p.marketCap,
    pe: p.pe,
    roe: p.roe,
  }));
  return ok({ stock, peers }, started, {
    meta: { version: getMarketModel().meta.version },
    headers: { 'Cache-Control': DAILY_CACHE },
  });
}
