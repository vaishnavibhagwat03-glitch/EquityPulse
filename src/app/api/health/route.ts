import { ok, startTimer } from '@/lib/server/apiResponse';
import { getMarketModel } from '@/lib/server/marketData';

/** GET /api/health — liveness plus the universe this instance is serving. */
export function GET(): Response {
  const started = startTimer();
  const { meta } = getMarketModel();
  return ok(
    {
      status: 'ok',
      universe: meta.version,
      instruments: meta.count,
      generatedMs: meta.generatedMs,
      uptimeSeconds: Math.round(process.uptime()),
    },
    started,
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
