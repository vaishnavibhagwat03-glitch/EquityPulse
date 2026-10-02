/**
 * Technical indicator kernels.
 *
 * Pure functions over plain number arrays. Output arrays are aligned to the
 * input; warm-up positions are `null` rather than a misleading number. The
 * algorithms are the textbook ones (Wilder smoothing for RSI and ATR, SMA-seeded
 * EMA) and the test suite pins them to published worked examples.
 *
 * The chart and the tests use these array versions. Universe generation uses
 * the allocation-free `*Last` kernels at the bottom of the file, which
 * implement the same algorithms but return only the final value.
 */

export type Series = (number | null)[];

export interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function sma(values: readonly number[], period: number): Series {
  const n = values.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || period > n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): Series {
  const n = values.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || period > n) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Population standard deviation over a rolling window. */
export function rollingStdev(values: readonly number[], period: number): Series {
  const n = values.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 1 || period > n) return out;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    sum += v;
    sumSq += v * v;
    if (i >= period) {
      const old = values[i - period]!;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      out[i] = Math.sqrt(Math.max(0, sumSq / period - mean * mean));
    }
  }
  return out;
}

export interface BollingerBands {
  upper: Series;
  middle: Series;
  lower: Series;
  stdev: Series;
}

export function bollinger(values: readonly number[], period = 20, mult = 2): BollingerBands {
  const middle = sma(values, period);
  const stdev = rollingStdev(values, period);
  const n = values.length;
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = middle[i];
    const s = stdev[i];
    if (m == null || s == null) continue;
    upper[i] = m + mult * s;
    lower[i] = m - mult * s;
  }
  return { upper, middle, lower, stdev };
}

/** Wilder's RSI. The first value appears at index `period`. */
export function rsi(values: readonly number[], period = 14): Series {
  const n = values.length;
  const out: Series = new Array(n).fill(null);
  if (n <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = rsiFrom(gain, loss);
  for (let i = period + 1; i < n; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = rsiFrom(gain, loss);
  }
  return out;
}

function rsiFrom(gain: number, loss: number): number {
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export interface MacdSeries {
  line: Series;
  signal: Series;
  histogram: Series;
}

export function macd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const n = values.length;
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f != null && s != null) line[i] = f - s;
  }
  const offset = line.findIndex(v => v != null);
  const signal: Series = new Array(n).fill(null);
  if (offset >= 0) {
    const dense = line.slice(offset) as number[];
    const sig = ema(dense, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[offset + i] = sig[i] ?? null;
  }
  const histogram: Series = line.map((v, i) => {
    const s = signal[i];
    return v == null || s == null ? null : v - s;
  });
  return { line, signal, histogram };
}

/** Wilder's ATR. True range needs a previous close, so the first value is at `period`. */
export function atr(bars: readonly OhlcBar[], period = 14): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = (i: number): number => {
    const c = bars[i]!;
    const p = bars[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  };
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out[i] = prev;
  }
  return out;
}

export interface VolumeProfileBin {
  low: number;
  high: number;
  mid: number;
  volume: number;
  upVolume: number;
  downVolume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  /** Index of the point-of-control (heaviest) bin, or -1 when empty. */
  poc: number;
  total: number;
  /** Price range holding ≥ 70% of volume, grown outward from the POC. */
  valueArea: { low: number; high: number; lowIndex: number; highIndex: number } | null;
}

/** Volume-at-price histogram, binned by each bar's typical price. */
export function volumeProfile(bars: readonly OhlcBar[], binCount = 24): VolumeProfile {
  if (bars.length === 0 || binCount <= 0) return { bins: [], poc: -1, total: 0, valueArea: null };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (hi === lo) hi = lo + 1;
  const width = (hi - lo) / binCount;
  const bins: VolumeProfileBin[] = Array.from({ length: binCount }, (_, i) => ({
    low: lo + i * width,
    high: lo + (i + 1) * width,
    mid: lo + (i + 0.5) * width,
    volume: 0,
    upVolume: 0,
    downVolume: 0,
  }));
  let total = 0;
  for (const b of bars) {
    const typical = (b.high + b.low + b.close) / 3;
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((typical - lo) / width)));
    const bin = bins[idx]!;
    bin.volume += b.volume;
    if (b.close >= b.open) bin.upVolume += b.volume;
    else bin.downVolume += b.volume;
    total += b.volume;
  }
  let poc = 0;
  for (let i = 1; i < binCount; i++) if (bins[i]!.volume > bins[poc]!.volume) poc = i;

  let lower = poc;
  let upper = poc;
  let captured = bins[poc]!.volume;
  const target = total * 0.7;
  while (captured < target && (lower > 0 || upper < binCount - 1)) {
    const below = lower > 0 ? bins[lower - 1]!.volume : -1;
    const above = upper < binCount - 1 ? bins[upper + 1]!.volume : -1;
    if (above >= below) {
      upper++;
      captured += bins[upper]!.volume;
    } else {
      lower--;
      captured += bins[lower]!.volume;
    }
  }
  return {
    bins,
    poc,
    total,
    valueArea: {
      low: bins[lower]!.low,
      high: bins[upper]!.high,
      lowIndex: lower,
      highIndex: upper,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Allocation-free "last value" kernels.
 *
 * Generating 5,000+ rows with the array versions above costs a dozen array
 * allocations per row. These read a closing-price buffer directly and return
 * only the final value. Same algorithms; the tests assert parity.
 * ------------------------------------------------------------------------- */

export function smaLast(c: ArrayLike<number>, n: number, period: number): number | null {
  if (n < period || period <= 0) return null;
  let s = 0;
  for (let i = n - period; i < n; i++) s += c[i]!;
  return s / period;
}

/** EMA seeded like `ema()`. Returns `[previous, last]` so crosses can be detected. */
export function emaLastPair(
  c: ArrayLike<number>,
  n: number,
  period: number,
): [number | null, number | null] {
  if (n < period || period <= 0) return [null, null];
  let s = 0;
  for (let i = 0; i < period; i++) s += c[i]!;
  let e = s / period;
  let prev = e;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    prev = e;
    e = c[i]! * k + e * (1 - k);
  }
  return [n === period ? null : prev, e];
}

export function rsiLast(c: ArrayLike<number>, n: number, period = 14): number | null {
  if (n <= period) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i]! - c[i - 1]!;
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  for (let i = period + 1; i < n; i++) {
    const d = c[i]! - c[i - 1]!;
    g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
    l = (l * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return rsiFrom(g, l);
}

export interface MacdLast {
  line: number | null;
  signal: number | null;
  prevLine: number | null;
  prevSignal: number | null;
}

/** MACD(12, 26, 9) in one pass, signal seeded from the SMA of the first nine lines. */
export function macdLast(c: ArrayLike<number>, n: number): MacdLast {
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  const k9 = 2 / 10;
  let s12 = 0;
  let s26 = 0;
  let e12 = 0;
  let e26 = 0;
  let line: number | null = null;
  let prevLine: number | null = null;
  let signal: number | null = null;
  let prevSignal: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < n; i++) {
    const v = c[i]!;
    if (i < 12) s12 += v;
    if (i === 11) e12 = s12 / 12;
    else if (i > 11) e12 = v * k12 + e12 * (1 - k12);
    if (i < 26) s26 += v;
    if (i === 25) e26 = s26 / 26;
    else if (i > 25) e26 = v * k26 + e26 * (1 - k26);
    if (i >= 25) {
      prevLine = line;
      line = e12 - e26;
      if (seedCount < 9) {
        seedSum += line;
        seedCount++;
        if (seedCount === 9) signal = seedSum / 9;
      } else if (signal !== null) {
        prevSignal = signal;
        signal = line * k9 + signal * (1 - k9);
      }
    }
  }
  return { line, signal, prevLine, prevSignal };
}

export function bollingerLast(
  c: ArrayLike<number>,
  n: number,
  period = 20,
  mult = 2,
): { upper: number; middle: number; lower: number } | null {
  if (n < period) return null;
  let s = 0;
  let sq = 0;
  for (let i = n - period; i < n; i++) {
    const v = c[i]!;
    s += v;
    sq += v * v;
  }
  const mean = s / period;
  const sd = Math.sqrt(Math.max(0, sq / period - mean * mean));
  return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
}

/** Wilder ATR over the whole buffer. */
export function atrLast(
  h: ArrayLike<number>,
  l: ArrayLike<number>,
  c: ArrayLike<number>,
  n: number,
  period = 14,
): number | null {
  if (n <= period) return null;
  const tr = (i: number): number =>
    Math.max(h[i]! - l[i]!, Math.abs(h[i]! - c[i - 1]!), Math.abs(l[i]! - c[i - 1]!));
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let a = sum / period;
  for (let i = period + 1; i < n; i++) a = (a * (period - 1) + tr(i)) / period;
  return a;
}
