/**
 * Compact sparkline encoding.
 *
 * A grid sparkline is ~64×20 px, so 64 vertical levels are plenty. Each point
 * is quantised to 6 bits and written as one base64url character: a one-month
 * trend costs 22 bytes per stock (~115 KB for the whole universe) instead of
 * a JSON array of prices.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LEVELS = ALPHABET.length - 1;

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]!] = i;

export function encodeSparkline(values: ArrayLike<number>): string {
  if (values.length === 0) return '';
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  let out = '';
  for (let i = 0; i < values.length; i++) {
    const level = span > 0 ? Math.round(((values[i]! - min) / span) * LEVELS) : LEVELS >> 1;
    out += ALPHABET[level];
  }
  return out;
}

/** Evenly samples `points` values from `values[from..to)`, always keeping the last. */
export function sampleSeries(
  values: ArrayLike<number>,
  from: number,
  to: number,
  points: number,
): number[] {
  const len = to - from;
  if (len <= points) return Array.from({ length: len }, (_, i) => values[from + i]!);
  const out: number[] = [];
  for (let k = 0; k < points; k++) {
    const i = from + Math.round((k * (len - 1)) / (points - 1));
    out.push(values[i]!);
  }
  return out;
}

/** Decodes to normalised values in [0, 1] (shape only). */
export function decodeSparkline(encoded: string): number[] {
  const out = new Array<number>(encoded.length);
  for (let i = 0; i < encoded.length; i++) out[i] = (LOOKUP[encoded[i]!] ?? 0) / LEVELS;
  return out;
}

/** SVG polyline points for a normalised series inside a width × height box. */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 1.5,
): string {
  if (values.length < 2) return '';
  const step = (width - pad * 2) / (values.length - 1);
  const h = height - pad * 2;
  let pts = '';
  for (let i = 0; i < values.length; i++) {
    const x = pad + i * step;
    const y = pad + (1 - values[i]!) * h;
    pts += `${i ? ' ' : ''}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return pts;
}

/** Normalises an arbitrary numeric series to [0, 1]. */
export function normalise(values: readonly number[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  return values.map(v => (span > 0 ? (v - min) / span : 0.5));
}
