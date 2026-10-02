import { DAILY_CACHE, ok, startTimer } from '@/lib/server/apiResponse';
import { getMarketModel, getSectors } from '@/lib/server/marketData';

/** GET /api/sectors — sector summaries at the snapshot: size, cap-weighted move, breadth, industries. */
export function GET(): Response {
  const started = startTimer();
  const sectors = getSectors();
  return ok(sectors, started, {
    meta: { count: sectors.length, version: getMarketModel().meta.version },
    headers: { 'Cache-Control': DAILY_CACHE },
  });
}
