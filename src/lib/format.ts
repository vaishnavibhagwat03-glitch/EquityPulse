/**
 * Number and time formatting, Indian conventions.
 *
 * Grouping follows the Indian system (12,34,567), compact values use lakh (L,
 * 10⁵) and crore (Cr, 10⁷), and times are shown in IST regardless of the
 * viewer's timezone. Intl formatters are expensive to construct, so they are
 * created once and reused — these run inside every grid cell render.
 */

const nf = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max });
    nf.set(key, f);
  }
  return f;
}

export const DASH = '—';

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export function formatNumber(
  v: number | null | undefined,
  decimals = 2,
  minDecimals = decimals,
): string {
  return isNum(v) ? formatter(minDecimals, decimals).format(v) : DASH;
}

export const formatPrice = (v: number | null | undefined): string => formatNumber(v, 2);

export const formatInr = (v: number | null | undefined, decimals = 2): string =>
  isNum(v) ? `₹${formatNumber(v, decimals)}` : DASH;

export function formatSigned(v: number | null | undefined, decimals = 2): string {
  if (!isNum(v)) return DASH;
  const s = formatNumber(Math.abs(v), decimals);
  if (v > 0) return `+${s}`;
  if (v < 0) return `−${s}`;
  return s;
}

export function formatPercent(
  v: number | null | undefined,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  if (!isNum(v)) return DASH;
  const { decimals = 2, signed = false } = options;
  return `${signed ? formatSigned(v, decimals) : formatNumber(v, decimals)}%`;
}

/** Indian compact form: 1.05 Cr, 45.20 L, 8,420. */
export function formatCompact(v: number | null | undefined, decimals = 2): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}${formatNumber(a / 1e7, decimals)} Cr`;
  if (a >= 1e5) return `${sign}${formatNumber(a / 1e5, decimals)} L`;
  return `${sign}${formatNumber(a, 0)}`;
}

/** Market cap given in ₹ crore: "₹19.77 L Cr" above a lakh crore, else "₹82,000 Cr". */
export function formatMarketCap(crore: number | null | undefined, compact = true): string {
  if (!isNum(crore)) return DASH;
  if (compact && crore >= 1e5) return `₹${formatNumber(crore / 1e5, 2)} L Cr`;
  return `₹${formatNumber(crore, 0)} Cr`;
}

/** Crore amounts below one crore read better in lakh. */
export function formatCrore(crore: number | null | undefined): string {
  if (!isNum(crore)) return DASH;
  if (crore >= 1e5) return `₹${formatNumber(crore / 1e5, 2)} L Cr`;
  if (crore >= 1) return `₹${formatNumber(crore, crore >= 100 ? 0 : 2)} Cr`;
  return `₹${formatNumber(crore * 100, 2)} L`;
}

export function formatInteger(v: number | null | undefined): string {
  return formatNumber(v, 0);
}

export function formatRatio(v: number | null | undefined, decimals = 2): string {
  return formatNumber(v, decimals);
}

const IST = 'Asia/Kolkata';
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: IST,
});
const shortTimeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: IST,
});
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: IST,
});
const dayMonthFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: IST,
});

export const formatTime = (ts: number): string => timeFmt.format(ts);
export const formatShortTime = (ts: number): string => shortTimeFmt.format(ts);
export const formatDate = (ts: number): string => dateFmt.format(ts);
export const formatDayMonth = (ts: number): string => dayMonthFmt.format(ts);

/** "+1.42%" style class hint: 1, -1 or 0. */
export const direction = (v: number | null | undefined): 1 | -1 | 0 =>
  !isNum(v) || Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;
