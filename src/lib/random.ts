/**
 * Deterministic randomness.
 *
 * Two flavours are needed:
 *
 * - **Sequential** (`createRng`): a small fast PRNG for per-company attributes
 *   that are drawn once, in order, during universe generation.
 * - **Counter-based** (`noise`, `normalAt`): a pure function of
 *   `(seed, stream, index)`. Price paths use this so that any window of any
 *   stock's history can be regenerated on demand, in any order, and always
 *   agree with the universe snapshot. There is no state to carry between calls.
 */

/** lowbias32 integer hash (Chris Wellons). Full avalanche, two multiplies. */
export function hash32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Combines three integers into one well-mixed 32-bit value. */
export function hash3(a: number, b: number, c: number): number {
  return hash32((a ^ hash32((b ^ hash32(c >>> 0)) >>> 0)) >>> 0);
}

const INV_2_32 = 1 / 4294967296;

/** Uniform in the open interval (0, 1) for a given coordinate. */
export function noise(seed: number, stream: number, index: number): number {
  return (hash3(seed, stream, index) + 0.5) * INV_2_32;
}

/**
 * Standard normal for a given coordinate (Box–Muller). The second uniform is
 * derived from the first hash with one extra mix, so a draw costs four hash
 * rounds rather than six — this sits in the inner loop of universe generation.
 */
export function normalAt(seed: number, stream: number, index: number): number {
  const h = hash3(seed, stream, index);
  const u1 = (h + 0.5) * INV_2_32;
  const u2 = (hash32((h ^ 0x9e3779b9) >>> 0) + 0.5) * INV_2_32;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Stable 32-bit hash of a string (FNV-1a), for deriving seeds from symbols. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform [0, 1). */
  next(): number;
  /** Standard normal. */
  normal(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

/** mulberry32: tiny, fast, passes BigCrush for this use. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) * INV_2_32;
  };

  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };

  return {
    next,
    normal,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: items => items[Math.floor(next() * items.length)] as (typeof items)[number],
    chance: p => next() < p,
  };
}

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Rounds to a fixed number of decimals without string round-tripping. */
export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
