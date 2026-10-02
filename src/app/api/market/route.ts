import { ok, startTimer } from '@/lib/server/apiResponse';
import { getMarketModel, getOverview } from '@/lib/server/marketData';

/** GET /api/market — snapshot overview: breadth, indices, sectors, movers, day-change distribution. */
export function GET(): Response {
  const started = startTimer();
  return ok(getOverview(), started, {
    meta: { version: getMarketModel().meta.version },
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120' },
  });
}
