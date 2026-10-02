import { CATEGORY_LABELS, FILTER_DEFINITIONS } from '@/lib/filters/definitions';
import { ok, startTimer } from '@/lib/server/apiResponse';

/** GET /api/filters/definitions — the screener's filter catalogue (53 criteria). */
export function GET(): Response {
  const started = startTimer();
  return ok({ categories: CATEGORY_LABELS, filters: FILTER_DEFINITIONS }, started, {
    meta: { count: FILTER_DEFINITIONS.length },
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
