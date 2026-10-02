/**
 * Trading calendar and IST helpers.
 *
 * Sessions are weekdays; exchange holidays are not modelled. Times are handled
 * in IST (UTC+05:30, no daylight saving) because that is how Indian market data
 * is quoted, regardless of where the viewer is.
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** NSE continuous session, minutes after IST midnight. */
export const SESSION_OPEN_MIN = 9 * 60 + 15;
export const SESSION_CLOSE_MIN = 15 * 60 + 30;
export const SESSION_MINUTES = SESSION_CLOSE_MIN - SESSION_OPEN_MIN; // 375

/** UTC epoch ms of IST midnight for the IST calendar day containing `ts`. */
export function istMidnight(ts: number): number {
  const istDay = Math.floor((ts + IST_OFFSET_MS) / DAY_MS);
  return istDay * DAY_MS - IST_OFFSET_MS;
}

/** Day of week (0 = Sunday) in IST. 1970-01-01 was a Thursday (4). */
export function istWeekday(ts: number): number {
  const day = Math.floor((ts + IST_OFFSET_MS) / DAY_MS);
  return (((day + 4) % 7) + 7) % 7;
}

export const isWeekend = (ts: number): boolean => {
  const d = istWeekday(ts);
  return d === 0 || d === 6;
};

/** IST midnight of the most recent weekday on or before `ts`. */
export function latestSessionDay(ts: number): number {
  let day = istMidnight(ts);
  while (isWeekend(day + DAY_MS / 2)) day -= DAY_MS;
  return day;
}

/**
 * Session days ending at `asOfDay` (IST midnight, inclusive), oldest first.
 * `count` weekdays are returned.
 */
export function sessionDays(asOfDay: number, count: number): number[] {
  const key = `${asOfDay}:${count}`;
  const cached = sessionCache.get(key);
  if (cached) return cached;
  const out = new Array<number>(count);
  let day = asOfDay;
  for (let i = count - 1; i >= 0; i--) {
    while (isWeekend(day + DAY_MS / 2)) day -= DAY_MS;
    out[i] = day;
    day -= DAY_MS;
  }
  if (sessionCache.size > 64) sessionCache.clear();
  sessionCache.set(key, out);
  return out;
}

// Calendars are requested for the same few (asOf, length) pairs thousands of
// times during generation; callers must treat the arrays as read-only.
const sessionCache = new Map<string, number[]>();

/** UTC epoch ms of the session open (09:15 IST) for a given IST midnight. */
export const sessionOpenTs = (istMidnightTs: number): number =>
  istMidnightTs + SESSION_OPEN_MIN * 60_000;

/** ISO date (YYYY-MM-DD) of an IST midnight timestamp. */
export function isoDate(istMidnightTs: number): string {
  return new Date(istMidnightTs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST midnight for an ISO date string (YYYY-MM-DD). */
export function fromIsoDate(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) - IST_OFFSET_MS;
}

export type SessionPhase = 'PRE_OPEN' | 'OPEN' | 'CLOSED';

/** Real-world NSE session phase at `ts`. */
export function sessionPhase(ts: number): SessionPhase {
  if (isWeekend(ts)) return 'CLOSED';
  const minutes = Math.floor(((ts + IST_OFFSET_MS) % DAY_MS) / 60_000);
  if (minutes >= 9 * 60 && minutes < SESSION_OPEN_MIN) return 'PRE_OPEN';
  if (minutes >= SESSION_OPEN_MIN && minutes < SESSION_CLOSE_MIN) return 'OPEN';
  return 'CLOSED';
}
