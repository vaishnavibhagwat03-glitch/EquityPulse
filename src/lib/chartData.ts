import type { Candle, HistoryInterval, LiveQuote, Timeframe } from '@/types/market';
import { IST_OFFSET_MS } from './market/calendar';
import {
  bollinger,
  ema,
  rsi,
  sma,
  volumeProfile,
  type Series,
  type VolumeProfile,
} from './technicalIndicators';

/**
 * Chart data preparation — pure functions, no chart library.
 *
 * Indicator series are computed once per (symbol, interval) and memoised by the
 * caller; toggling an indicator only changes visibility. Times are mapped for
 * Lightweight Charts, which renders in UTC: daily bars use IST calendar dates,
 * intraday bars are shifted by +05:30 so the axis reads IST wall-clock time.
 */

export interface TimeframeSpec {
  id: Timeframe;
  label: string;
  interval: HistoryInterval;
  /** Bars visible initially; null shows everything loaded. */
  visibleBars: number | null;
  description: string;
}

export const TIMEFRAMES: readonly TimeframeSpec[] = [
  {
    id: '1D',
    label: '1D',
    interval: '5m',
    visibleBars: null,
    description: 'Today · 5-minute bars',
  },
  {
    id: '1W',
    label: '1W',
    interval: '15m',
    visibleBars: null,
    description: 'Five sessions · 15-minute bars',
  },
  { id: '1M', label: '1M', interval: '1d', visibleBars: 22, description: 'One month · daily bars' },
  {
    id: '3M',
    label: '3M',
    interval: '1d',
    visibleBars: 64,
    description: 'Three months · daily bars',
  },
  { id: '1Y', label: '1Y', interval: '1d', visibleBars: 252, description: 'One year · daily bars' },
  {
    id: '5Y',
    label: '5Y',
    interval: '1w',
    visibleBars: 262,
    description: 'Five years · weekly bars',
  },
];

export const TIMEFRAME_BY_ID = new Map(TIMEFRAMES.map(t => [t.id, t]));

export type OverlayId = 'sma20' | 'sma50' | 'sma200' | 'ema12' | 'ema26';
export type IndicatorId = OverlayId | 'bb' | 'rsi' | 'vp';

export interface IndicatorDef {
  id: IndicatorId;
  label: string;
  /** CSS custom property holding the validated series colour. */
  colorVar: string;
  group: 'Moving averages' | 'Bands' | 'Oscillators' | 'Volume';
  description: string;
}

/** Fixed colour per indicator (colour follows the entity, never its order). */
export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: 'sma20',
    label: 'SMA 20',
    colorVar: '--series-1',
    group: 'Moving averages',
    description: '20-period simple moving average',
  },
  {
    id: 'sma50',
    label: 'SMA 50',
    colorVar: '--series-2',
    group: 'Moving averages',
    description: '50-period simple moving average',
  },
  {
    id: 'sma200',
    label: 'SMA 200',
    colorVar: '--series-3',
    group: 'Moving averages',
    description: '200-period simple moving average',
  },
  {
    id: 'ema12',
    label: 'EMA 12',
    colorVar: '--series-4',
    group: 'Moving averages',
    description: '12-period exponential moving average',
  },
  {
    id: 'ema26',
    label: 'EMA 26',
    colorVar: '--series-5',
    group: 'Moving averages',
    description: '26-period exponential moving average',
  },
  {
    id: 'bb',
    label: 'Bollinger 20, 2',
    colorVar: '--series-6',
    group: 'Bands',
    description: '20-period SMA ± 2 standard deviations',
  },
  {
    id: 'rsi',
    label: 'RSI 14',
    colorVar: '--series-1',
    group: 'Oscillators',
    description: 'Wilder RSI, own pane with 30 / 70 levels',
  },
  {
    id: 'vp',
    label: 'Volume profile',
    colorVar: '--text-muted',
    group: 'Volume',
    description: 'Volume traded at each price over the visible range',
  },
];

export const OVERLAY_IDS: readonly OverlayId[] = ['sma20', 'sma50', 'sma200', 'ema12', 'ema26'];

export type ChartTime = number | string;

export interface LinePoint {
  time: ChartTime;
  value: number;
}

export interface ChartModel {
  interval: HistoryInterval;
  candles: Candle[];
  times: ChartTime[];
  overlays: Record<OverlayId, LinePoint[]>;
  bands: { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] };
  rsi: LinePoint[];
}

const isIntraday = (interval: HistoryInterval): boolean => interval === '5m' || interval === '15m';

export function chartTime(epochSeconds: number, interval: HistoryInterval): ChartTime {
  if (isIntraday(interval)) return epochSeconds + IST_OFFSET_MS / 1000;
  return new Date(epochSeconds * 1000 + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function toPoints(series: Series, times: readonly ChartTime[]): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v))
      out.push({ time: times[i]!, value: v });
  }
  return out;
}

export function buildChartModel(candles: readonly Candle[], interval: HistoryInterval): ChartModel {
  const list = [...candles];
  const times = list.map(c => chartTime(c.time, interval));
  const closes = list.map(c => c.close);
  const bb = bollinger(closes, 20, 2);
  return {
    interval,
    candles: list,
    times,
    overlays: {
      sma20: toPoints(sma(closes, 20), times),
      sma50: toPoints(sma(closes, 50), times),
      sma200: toPoints(sma(closes, 200), times),
      ema12: toPoints(ema(closes, 12), times),
      ema26: toPoints(ema(closes, 26), times),
    },
    bands: {
      upper: toPoints(bb.upper, times),
      middle: toPoints(bb.middle, times),
      lower: toPoints(bb.lower, times),
    },
    rsi: toPoints(rsi(closes, 14), times),
  };
}

/**
 * Makes freshly loaded history agree with the live quote. Daily bars take the
 * live price, range and volume for today. Intraday bars are eased onto the
 * live price over the last few bars, so the path joins the tape without a step.
 */
export function reconcileWithQuote(
  candles: readonly Candle[],
  interval: HistoryInterval,
  quote: LiveQuote | undefined,
): Candle[] {
  if (!quote || !candles.length) return [...candles];
  const out = candles.map(c => ({ ...c }));
  const last = out[out.length - 1]!;
  if (!isIntraday(interval)) {
    last.close = quote.price;
    last.high = Math.max(last.high, quote.dayHigh, quote.price);
    last.low = Math.min(last.low, quote.dayLow, quote.price);
    if (interval === '1d') last.volume = Math.max(last.volume, quote.volume);
    return out;
  }
  const ratio = quote.price / last.close;
  if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-7) return out;
  const k = Math.min(24, out.length);
  for (let j = 0; j < k; j++) {
    const bar = out[out.length - k + j]!;
    const f = 1 + (ratio - 1) * ((j + 1) / k);
    bar.open *= j === 0 ? 1 : f;
    bar.high *= f;
    bar.low *= f;
    bar.close *= f;
    bar.high = Math.max(bar.high, bar.open, bar.close);
    bar.low = Math.min(bar.low, bar.open, bar.close);
  }
  last.close = quote.price;
  return out;
}

/**
 * Applies a live tick. Daily/weekly: today's bar moves. Intraday: the current
 * bucket updates, or a new bucket opens when the tick crosses into it.
 * Returns the (mutated) array and whether a bar was appended.
 */
export function applyTick(
  candles: Candle[],
  interval: HistoryInterval,
  price: number,
  volumeDelta: number,
  tsMs: number,
): { appended: boolean } {
  const last = candles[candles.length - 1];
  if (!last) return { appended: false };
  if (isIntraday(interval)) {
    const bucket = (interval === '5m' ? 5 : 15) * 60;
    const start = Math.floor(tsMs / 1000 / bucket) * bucket;
    if (start > last.time) {
      candles.push({
        time: start,
        open: last.close,
        high: Math.max(last.close, price),
        low: Math.min(last.close, price),
        close: price,
        volume: Math.max(0, volumeDelta),
      });
      return { appended: true };
    }
  }
  last.close = price;
  if (price > last.high) last.high = price;
  if (price < last.low) last.low = price;
  last.volume += Math.max(0, volumeDelta);
  return { appended: false };
}

/** Volume profile over the bars currently in view. */
export function visibleProfile(
  candles: readonly Candle[],
  from: number,
  to: number,
  bins = 28,
): VolumeProfile {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(candles.length, Math.ceil(to) + 1);
  return volumeProfile(candles.slice(a, b), bins);
}

export function lastValue(points: readonly LinePoint[]): number | null {
  return points.length ? points[points.length - 1]!.value : null;
}
