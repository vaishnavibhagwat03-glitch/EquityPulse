import { clamp, hash3, noise, normalAt } from '@/lib/random';
import type { Candle } from '@/types/market';
import { DAY_MS, SESSION_MINUTES, sessionDays, sessionOpenTs } from './calendar';

/**
 * Factor-model price paths.
 *
 * Daily log return of stock i on session t (t = 0 is today, t = 1 yesterday…):
 *
 *   r(i,t) = drift(i) + β(i)·M(t) + γ(i)·S(sector(i), t) + σ_idio(i)·v(t)·z(i,t) + J(i,t)
 *
 * M is a market factor with volatility clustering v(t); S is a sector factor
 * with slowly rotating trends; z and the jump term J are counter-based draws,
 * so a stock's return on any day is a pure function of (seed, t).
 *
 * Paths are generated *backwards* from an anchor: today's close is fixed (the
 * snapshot price) and earlier closes are C(t+1) = C(t) / exp(r(t)). Any window
 * of history can therefore be produced independently and will always join up
 * with the universe snapshot.
 */

export const MARKET_VOL = 0.135; // annualised
export const SECTOR_VOL = 0.1;
export const TRADING_DAYS = 252;
const SQRT_252 = Math.sqrt(TRADING_DAYS);

/** Length of precomputed factor history: ~6.3 years of sessions. */
export const FACTOR_DAYS = 1600;

// Counter-based stream identifiers.
const S_RET = 11;
const S_JUMP = 12;
const S_JUMP_SIZE = 13;
const S_GAP = 14;
const S_WICK_HI = 15;
const S_WICK_LO = 16;
const S_VOL = 17;
const S_EVENT = 18;
const S_INTRADAY = 19;
const S_INTRADAY_VOL = 20;
const S_INTRADAY_WICK = 21;

export interface FactorModel {
  seed: number;
  /** Daily market factor return, index = sessions before today. */
  market: Float64Array;
  /** Volatility-regime multiplier, index = sessions before today. */
  regime: Float64Array;
  sectors: Map<string, Float64Array>;
}

export function buildFactorModel(
  seed: number,
  sectorNames: readonly string[],
  days = FACTOR_DAYS,
): FactorModel {
  const market = new Float64Array(days);
  const regime = new Float64Array(days);
  const dailyMarketVol = MARKET_VOL / SQRT_252;
  const marketDrift = 0.11 / TRADING_DAYS;

  // AR(1) log-volatility gives calm and turbulent stretches. The series is then
  // calibrated so the most recent quarter averages 1: configured volatilities
  // describe the current regime, while older history keeps its storms.
  let h = 0;
  for (let t = days - 1; t >= 0; t--) {
    h = 0.97 * h + 0.04 * normalAt(seed, 1, t);
    regime[t] = Math.exp(h);
  }
  const recent = Math.min(63, days);
  let recentMean = 0;
  for (let t = 0; t < recent; t++) recentMean += regime[t]!;
  recentMean /= recent;
  for (let t = 0; t < days; t++) {
    regime[t] = regime[t]! / recentMean;
    market[t] = marketDrift + dailyMarketVol * regime[t]! * normalAt(seed, 2, t);
  }

  const sectors = new Map<string, Float64Array>();
  const dailySectorVol = SECTOR_VOL / SQRT_252;
  sectorNames.forEach((name, s) => {
    const series = new Float64Array(days);
    // Each sector rotates through multi-month cycles of out/under-performance.
    const amp = (0.05 + 0.2 * noise(seed, 3, s)) / TRADING_DAYS;
    const period = 120 + 280 * noise(seed, 4, s);
    const phase = 2 * Math.PI * noise(seed, 5, s);
    for (let t = 0; t < days; t++) {
      const trend = amp * Math.sin((2 * Math.PI * t) / period + phase);
      series[t] = trend + dailySectorVol * regime[t]! * normalAt(seed, 100 + s, t);
    }
    sectors.set(name, series);
  });

  return { seed, market, regime, sectors };
}

/** Everything needed to regenerate one stock's price history. */
export interface PathParams {
  seed: number;
  sector: string;
  /** Today's last traded price. */
  anchor: number;
  /** Loading on the market factor. */
  beta: number;
  /** Loading on the sector factor. */
  gamma: number;
  /** Annualised idiosyncratic volatility. */
  idioVol: number;
  /** Annualised drift. */
  drift: number;
  /** Long-run average daily volume, shares. */
  avgVolume: number;
  tickSize: number;
  /** Probability of a news event today (volume and price shock). */
  eventToday: number;
  /** Size of event shocks in idiosyncratic standard deviations (larger for small caps). */
  eventScale: number;
}

/** NSE price-banded tick sizes. */
export function tickSizeFor(price: number): number {
  if (price < 250) return 0.01;
  if (price < 1000) return 0.05;
  if (price < 5000) return 0.1;
  if (price < 10000) return 0.5;
  if (price < 20000) return 1;
  return 5;
}

export const roundToTick = (price: number, tick: number): number =>
  Math.round(Math.round(price / tick) * tick * 100) / 100;

export interface DailySeries {
  /** IST midnight of each session, oldest first. */
  days: number[];
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  /** Daily log return ending each session (close to close). */
  returns: Float64Array;
  length: number;
}

/** Total annualised volatility implied by the parameters (excluding jumps). */
export function totalVol(p: PathParams): number {
  return Math.sqrt(
    p.beta * p.beta * MARKET_VOL * MARKET_VOL +
      p.gamma * p.gamma * SECTOR_VOL * SECTOR_VOL +
      p.idioVol * p.idioVol,
  );
}

/** Daily log return for session t (0 = today). */
export function returnAt(
  p: PathParams,
  f: FactorModel,
  t: number,
  sector: Float64Array | undefined = f.sectors.get(p.sector),
): number {
  const ft = Math.min(t, f.market.length - 1);
  const dailyIdio = p.idioVol / SQRT_252;
  const regime = f.regime[ft]!;
  let r =
    p.drift / TRADING_DAYS +
    p.beta * f.market[ft]! +
    p.gamma * (sector ? sector[ft]! : 0) +
    dailyIdio * regime * normalAt(p.seed, S_RET, t);

  // Rare idiosyncratic shocks (results, block deals, guidance changes).
  const jumpProb = t === 0 ? p.eventToday : 0.006;
  if (noise(p.seed, t === 0 ? S_EVENT : S_JUMP, t) < jumpProb) {
    r += normalAt(p.seed, S_JUMP_SIZE, t) * dailyIdio * p.eventScale;
  }
  // Exchange price bands cap a single session's move.
  return clamp(r, -0.18, 0.18);
}

/**
 * Generates `count` daily bars ending today, oldest first.
 * `asOfDay` is IST midnight of today's session.
 */
export function generateDaily(
  p: PathParams,
  f: FactorModel,
  count: number,
  asOfDay: number,
): DailySeries {
  const n = count;
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);
  const returns = new Float64Array(n);
  const days = sessionDaysEndingToday(asOfDay, n);

  const dailyVol = totalVol(p) / SQRT_252;
  const tick = p.tickSize;
  const sector = f.sectors.get(p.sector);

  // Closes backwards from the anchor; index i = n - 1 - t.
  let c = p.anchor;
  for (let t = 0; t < n; t++) {
    const i = n - 1 - t;
    const r = returnAt(p, f, t, sector);
    returns[i] = r;
    close[i] = c;
    c = c / Math.exp(r);
  }

  for (let t = 0; t < n; t++) {
    const i = n - 1 - t;
    const prevClose = i > 0 ? close[i - 1]! : close[i]! / Math.exp(returns[i]!);
    const r = returns[i]!;
    const regime = f.regime[Math.min(t, f.regime.length - 1)]!;
    // Part of each move happens overnight, as an opening gap.
    const gapShare = 0.15 + 0.3 * noise(p.seed, S_GAP, t);
    const o = prevClose * Math.exp(r * gapShare);
    const cl = close[i]!;
    const wickScale = dailyVol * regime * 0.42;
    const hi = Math.max(o, cl) * Math.exp(Math.abs(normalAt(p.seed, S_WICK_HI, t)) * wickScale);
    const lo = Math.min(o, cl) * Math.exp(-Math.abs(normalAt(p.seed, S_WICK_LO, t)) * wickScale);

    open[i] = roundToTick(o, tick);
    high[i] = roundToTick(hi, tick);
    low[i] = Math.max(tick, roundToTick(lo, tick));
    close[i] = roundToTick(cl, tick);
    // Keep the bar internally consistent after rounding.
    high[i] = Math.max(high[i]!, open[i]!, close[i]!);
    low[i] = Math.min(low[i]!, open[i]!, close[i]!);

    // Volume clusters with the size of the move; news days trade heavily.
    const surprise = Math.abs(r) / Math.max(dailyVol, 1e-6);
    let v =
      p.avgVolume * Math.exp(0.33 * normalAt(p.seed, S_VOL, t) - 0.055) * (0.72 + 0.28 * surprise);
    const isEvent = noise(p.seed, t === 0 ? S_EVENT : S_JUMP, t) < (t === 0 ? p.eventToday : 0.006);
    if (isEvent) v *= 2.2 + 3.5 * noise(p.seed, S_EVENT + 50, t);
    volume[i] = Math.max(100, Math.round(v));
  }

  return { days, open, high, low, close, volume, returns, length: n };
}

const todayCalendarCache = new Map<string, number[]>();

/**
 * Today (any day of week — the simulation trades continuously) preceded by the
 * previous weekday sessions. Cached; treat the result as read-only.
 */
export function sessionDaysEndingToday(asOfDay: number, count: number): number[] {
  if (count <= 0) return [];
  const key = `${asOfDay}:${count}`;
  let days = todayCalendarCache.get(key);
  if (!days) {
    days = [...sessionDays(asOfDay - DAY_MS, count - 1), asOfDay];
    if (todayCalendarCache.size > 64) todayCalendarCache.clear();
    todayCalendarCache.set(key, days);
  }
  return days;
}

export function dailyToCandles(series: DailySeries, from = 0): Candle[] {
  const out: Candle[] = [];
  for (let i = from; i < series.length; i++) {
    out.push({
      time: Math.floor(sessionOpenTs(series.days[i]!) / 1000),
      open: series.open[i]!,
      high: series.high[i]!,
      low: series.low[i]!,
      close: series.close[i]!,
      volume: series.volume[i]!,
    });
  }
  return out;
}

/** Aggregates daily candles into Monday-start weeks. */
export function toWeekly(daily: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  let currentWeek = -1;
  for (const d of daily) {
    // Days since the epoch in IST, shifted so weeks start on Monday.
    const istDay = Math.floor((d.time * 1000 + 5.5 * 3600_000) / DAY_MS);
    const week = Math.floor((istDay + 3) / 7);
    if (week !== currentWeek || !current) {
      if (current) out.push(current);
      current = { ...d };
      currentWeek = week;
    } else {
      current.high = Math.max(current.high, d.high);
      current.low = Math.min(current.low, d.low);
      current.close = d.close;
      current.volume += d.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

export const INTRADAY_STEPS = 75; // 5-minute bars in a 375-minute session

/**
 * Splits one daily bar into 5-minute bars with a Brownian bridge that starts at
 * the open, ends at the close and touches the day's high and low exactly.
 *
 * `startTs` is the epoch ms of the first bar's open.
 */
export function intradayBars(
  p: PathParams,
  t: number,
  day: { open: number; high: number; low: number; close: number; volume: number },
  startTs: number,
  steps = INTRADAY_STEPS,
): Candle[] {
  const base = hash3(p.seed, S_INTRADAY, t) % 1_000_000;
  const walk = new Float64Array(steps + 1);
  for (let k = 1; k <= steps; k++) walk[k] = walk[k - 1]! + normalAt(p.seed, S_INTRADAY, base + k);
  // Pin both ends to zero.
  const end = walk[steps]!;
  let maxPos = 0;
  let maxNeg = 0;
  for (let k = 0; k <= steps; k++) {
    walk[k] = walk[k]! - (end * k) / steps;
    if (walk[k]! > maxPos) maxPos = walk[k]!;
    if (walk[k]! < maxNeg) maxNeg = walk[k]!;
  }

  const lo = Math.log(day.open);
  const lc = Math.log(day.close);
  const upRoom = Math.log(day.high) - Math.max(lo, lc);
  const downRoom = Math.min(lo, lc) - Math.log(day.low);
  const sUp = maxPos > 1e-9 ? upRoom / maxPos : 0;
  const sDown = maxNeg < -1e-9 ? downRoom / -maxNeg : 0;

  const path = new Float64Array(steps + 1);
  for (let k = 0; k <= steps; k++) {
    const w = walk[k]!;
    path[k] = Math.exp(lo + ((lc - lo) * k) / steps + (w >= 0 ? w * sUp : w * sDown));
  }
  path[0] = day.open;
  path[steps] = day.close;

  // U-shaped intraday volume: heavy at the open and into the close.
  const weights = new Float64Array(steps);
  let wsum = 0;
  for (let k = 0; k < steps; k++) {
    const w =
      (1 + 1.7 * Math.exp(-k / 7) + 1.1 * Math.exp(-(steps - 1 - k) / 9)) *
      Math.exp(0.35 * normalAt(p.seed, S_INTRADAY_VOL, base + k));
    weights[k] = w;
    wsum += w;
  }

  const minutesPerBar = SESSION_MINUTES / steps;
  const tick = p.tickSize;
  const bars: Candle[] = new Array(steps);
  let hiIdx = 0;
  let loIdx = 0;
  for (let k = 0; k < steps; k++) {
    const o = path[k]!;
    const c = path[k + 1]!;
    const wick = Math.abs(c - o) * 0.6 + o * 0.0006;
    const h = Math.min(
      day.high,
      Math.max(o, c) + wick * noise(p.seed, S_INTRADAY_WICK, base + 2 * k),
    );
    const l = Math.max(
      day.low,
      Math.min(o, c) - wick * noise(p.seed, S_INTRADAY_WICK, base + 2 * k + 1),
    );
    bars[k] = {
      time: Math.floor((startTs + k * minutesPerBar * 60_000) / 1000),
      open: roundToTick(o, tick),
      high: roundToTick(h, tick),
      low: roundToTick(l, tick),
      close: roundToTick(c, tick),
      volume: Math.max(1, Math.round((day.volume * weights[k]!) / wsum)),
    };
    if (bars[k]!.high > bars[hiIdx]!.high) hiIdx = k;
    if (bars[k]!.low < bars[loIdx]!.low) loIdx = k;
  }
  // The session's extremes are printed exactly once each.
  bars[hiIdx]!.high = day.high;
  bars[loIdx]!.low = day.low;
  for (const b of bars) {
    b.high = Math.max(b.high, b.open, b.close);
    b.low = Math.min(b.low, b.open, b.close);
  }
  return bars;
}

/** Merges consecutive bars into larger buckets (e.g. three 5m bars → one 15m bar). */
export function aggregateBars(bars: readonly Candle[], size: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    if (!chunk.length) break;
    out.push({
      time: chunk[0]!.time,
      open: chunk[0]!.open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1]!.close,
      volume: chunk.reduce((a, b) => a + b.volume, 0),
    });
  }
  return out;
}
