import { describe, expect, it } from 'vitest';
import type { Candle, LiveQuote } from '@/types/market';
import {
  atr,
  atrLast,
  bollinger,
  bollingerLast,
  ema,
  emaLastPair,
  macd,
  macdLast,
  rollingStdev,
  rsi,
  rsiLast,
  sma,
  smaLast,
  volumeProfile,
} from '@/lib/technicalIndicators';
import {
  applyTick,
  buildChartModel,
  chartTime,
  lastValue,
  reconcileWithQuote,
  TIMEFRAME_BY_ID,
  TIMEFRAMES,
  visibleProfile,
} from '@/lib/chartData';
import { buildHistory } from '@/lib/market/history';
import { createRng } from '@/lib/random';
import { FIXED_NOW, market } from '../fixtures/market';

/** The 14-period RSI worked example from Wilder / StockCharts. */
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
  46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18,
  44.22, 44.57, 43.42, 42.66, 43.13,
];

function randomWalk(n: number, seed = 7): { closes: number[]; bars: Candle[] } {
  const rng = createRng(seed);
  const closes: number[] = [];
  const bars: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const open = p;
    p = Math.max(1, p * (1 + rng.normal() * 0.02));
    const high = Math.max(open, p) * (1 + rng.next() * 0.01);
    const low = Math.min(open, p) * (1 - rng.next() * 0.01);
    closes.push(p);
    bars.push({
      time: 1_700_000_000 + i * 86_400,
      open,
      high,
      low,
      close: p,
      volume: Math.round(1000 + rng.next() * 9000),
    });
  }
  return { closes, bars };
}

describe('moving averages', () => {
  it('SMA averages the trailing window and leaves the warm-up empty', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([1, 2], 3)).toEqual([null, null]);
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
  });

  it('EMA is seeded with the SMA and then smooths with k = 2 / (n + 1)', () => {
    const out = ema([1, 2, 3, 4, 5, 6], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2); // seed: SMA(1, 2, 3)
    expect(out[3]).toBeCloseTo(3); // 4 × 0.5 + 2 × 0.5
    expect(out[5]).toBeCloseTo(5);
  });
});

describe('Bollinger bands', () => {
  it('use the population standard deviation around the SMA', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]; // mean 5, population σ 2
    const bb = bollinger(values, 8, 2);
    expect(bb.middle[7]).toBe(5);
    expect(bb.stdev[7]).toBeCloseTo(2);
    expect(bb.upper[7]).toBeCloseTo(9);
    expect(bb.lower[7]).toBeCloseTo(1);
    expect(bb.upper[6]).toBeNull();
  });

  it('collapse onto the middle line for a flat series', () => {
    const bb = bollinger(new Array(25).fill(10), 20, 2);
    expect(bb.upper[24]).toBe(10);
    expect(bb.lower[24]).toBe(10);
    expect(rollingStdev([1, 2, 3], 1)).toEqual([null, null, null]);
  });
});

describe('RSI', () => {
  it('reproduces the published Wilder worked example', () => {
    const out = rsi(WILDER, 14);
    expect(out.slice(0, 14).every(v => v === null)).toBe(true);
    expect(out[14]).toBeCloseTo(70.46, 1);
    expect(out[15]).toBeCloseTo(66.25, 1);
  });

  it('is bounded and handles one-way markets', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
    expect(rsi([5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
    expect(rsi([1, 2], 14)).toEqual([null, null]);
    const values = rsi(randomWalk(300).closes).filter((v): v is number => v !== null);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
  });
});

describe('MACD and ATR', () => {
  it('MACD line is EMA 12 − EMA 26, the signal its 9-period EMA', () => {
    const { closes } = randomWalk(120);
    const m = macd(closes);
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    expect(m.line[24]).toBeNull();
    expect(m.line[25]).toBeCloseTo(e12[25]! - e26[25]!);
    expect(m.signal[32]).toBeNull();
    expect(m.signal[33]).toBeCloseTo(
      (m.line.slice(25, 34) as number[]).reduce((a, b) => a + b, 0) / 9,
    );
    expect(m.histogram[60]).toBeCloseTo(m.line[60]! - m.signal[60]!);
  });

  it('ATR uses the true range, including gaps from the previous close', () => {
    const bars = [
      { open: 10, high: 11, low: 9, close: 10, volume: 1 },
      { open: 14, high: 15, low: 14, close: 15, volume: 1 }, // gap up: TR = 15 − 10 = 5
      { open: 15, high: 16, low: 14, close: 15, volume: 1 }, // TR = 2
    ];
    expect(atr(bars, 2)).toEqual([null, null, 3.5]);
    expect(atr(bars, 5)).toEqual([null, null, null]);
  });
});

describe('allocation-free "last value" kernels', () => {
  it('match the array versions exactly', () => {
    for (const seed of [1, 2, 3]) {
      const { closes, bars } = randomWalk(260, seed);
      const n = closes.length;
      expect(smaLast(closes, n, 50)).toBeCloseTo(sma(closes, 50).at(-1)!, 9);
      expect(smaLast(closes, 10, 50)).toBeNull();
      const [prev, last] = emaLastPair(closes, n, 12);
      const full = ema(closes, 12);
      expect(last).toBeCloseTo(full.at(-1)!, 9);
      expect(prev).toBeCloseTo(full.at(-2)!, 9);
      expect(emaLastPair(closes, 12, 12)[0]).toBeNull();
      expect(rsiLast(closes, n)).toBeCloseTo(rsi(closes).at(-1)!, 9);
      expect(rsiLast(closes, 10)).toBeNull();
      const m = macd(closes);
      const ml = macdLast(closes, n);
      expect(ml.line).toBeCloseTo(m.line.at(-1)!, 9);
      expect(ml.signal).toBeCloseTo(m.signal.at(-1)!, 9);
      expect(ml.prevSignal).toBeCloseTo(m.signal.at(-2)!, 9);
      const bb = bollinger(closes);
      const bl = bollingerLast(closes, n)!;
      expect(bl.upper).toBeCloseTo(bb.upper.at(-1)!, 9);
      expect(bl.lower).toBeCloseTo(bb.lower.at(-1)!, 9);
      expect(bollingerLast(closes, 5)).toBeNull();
      const h = bars.map(b => b.high);
      const l = bars.map(b => b.low);
      expect(atrLast(h, l, closes, n)).toBeCloseTo(atr(bars).at(-1)!, 9);
      expect(atrLast(h, l, closes, 5)).toBeNull();
    }
  });
});

describe('volume profile', () => {
  it('bins volume by typical price, finds the point of control and a 70% value area', () => {
    const bars = [
      { open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { open: 11, high: 11, low: 11, close: 11, volume: 700 },
      { open: 12, high: 12, low: 12, close: 11.9, volume: 200 },
      { open: 19, high: 20, low: 19, close: 20, volume: 50 },
    ];
    const vp = volumeProfile(bars, 10);
    expect(vp.total).toBe(1050);
    expect(vp.bins.reduce((s, b) => s + b.volume, 0)).toBe(1050);
    // Typical prices 11 and 11.97 share the ₹11–12 bin: 700 + 200.
    expect(vp.poc).toBe(1);
    expect(vp.bins[vp.poc]!.volume).toBe(900);
    const inArea = vp.bins
      .slice(vp.valueArea!.lowIndex, vp.valueArea!.highIndex + 1)
      .reduce((s, b) => s + b.volume, 0);
    expect(inArea).toBeGreaterThanOrEqual(0.7 * vp.total);
    expect(vp.bins.reduce((s, b) => s + b.downVolume, 0)).toBe(200);
  });

  it('is empty for no bars', () => {
    expect(volumeProfile([])).toEqual({ bins: [], poc: -1, total: 0, valueArea: null });
  });
});

describe('chart data', () => {
  const { bars } = randomWalk(260);

  it('offers the six required timeframes', () => {
    expect(TIMEFRAMES.map(t => t.id)).toEqual(['1D', '1W', '1M', '3M', '1Y', '5Y']);
    expect(TIMEFRAME_BY_ID.get('1Y')!.visibleBars).toBe(252);
  });

  it('maps daily bars to IST calendar dates and intraday bars to IST wall-clock', () => {
    const t = Date.parse('2026-09-30T19:00:00Z') / 1000; // 1 Oct 00:30 IST
    expect(chartTime(t, '1d')).toBe('2026-10-01');
    expect(chartTime(t, '5m')).toBe(t + 5.5 * 3600);
  });

  it('builds every overlay aligned to the candles, skipping warm-up', () => {
    const model = buildChartModel(bars, '1d');
    expect(model.candles).toHaveLength(260);
    expect(model.overlays.sma20).toHaveLength(260 - 19);
    expect(model.overlays.sma200).toHaveLength(260 - 199);
    expect(model.overlays.ema26).toHaveLength(260 - 25);
    expect(model.bands.upper).toHaveLength(260 - 19);
    expect(model.rsi).toHaveLength(260 - 14);
    expect(model.overlays.sma50.at(-1)!.time).toBe(model.times.at(-1));
    expect(lastValue(model.overlays.sma50)).toBeCloseTo(
      sma(
        bars.map(b => b.close),
        50,
      ).at(-1)!,
    );
    expect(lastValue([])).toBeNull();
  });

  it('reconciles a loaded daily bar with the live quote', () => {
    const quote = { price: 999, dayHigh: 1000, dayLow: 1, volume: 1e9 } as LiveQuote;
    const out = reconcileWithQuote(bars, '1d', quote);
    expect(out.at(-1)).toMatchObject({ close: 999, high: 1000, low: 1, volume: 1e9 });
    expect(bars.at(-1)!.close).not.toBe(999); // input untouched
    expect(reconcileWithQuote(bars, '1d', undefined)).toEqual(bars);
  });

  it('eases intraday bars onto the live price without breaking OHLC invariants', () => {
    const intraday = bars.slice(0, 40);
    const quote = {
      price: intraday.at(-1)!.close * 1.03,
      dayHigh: 0,
      dayLow: 0,
      volume: 0,
    } as LiveQuote;
    const out = reconcileWithQuote(intraday, '5m', quote);
    expect(out.at(-1)!.close).toBe(quote.price);
    for (const b of out) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close) - 1e-9);
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close) + 1e-9);
    }
    expect(out[0]).toEqual(intraday[0]); // bars before the easing window are unchanged
  });

  it('applies ticks to the current bar and opens a new intraday bucket on time', () => {
    const start = 1_790_000_100 - (1_790_000_100 % 300);
    const candles: Candle[] = [
      { time: start, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    ];
    expect(applyTick(candles, '5m', 102, 5, (start + 60) * 1000)).toEqual({ appended: false });
    expect(candles[0]).toMatchObject({ close: 102, high: 102, volume: 15 });
    expect(applyTick(candles, '5m', 98, 3, (start + 300) * 1000)).toEqual({ appended: true });
    expect(candles[1]).toMatchObject({
      time: start + 300,
      open: 102,
      low: 98,
      high: 102,
      close: 98,
      volume: 3,
    });
    expect(applyTick([], '1d', 1, 1, 0)).toEqual({ appended: false });
  });

  it('profiles only the visible window', () => {
    const vp = visibleProfile(bars, 200, 259, 20);
    expect(vp.total).toBe(bars.slice(200).reduce((s, b) => s + b.volume, 0));
  });
});

describe('OHLCV history', () => {
  const model = market(300);

  it('serves 252+ daily bars with consistent OHLC that end on the snapshot', () => {
    const stock = model.stocks[0]!;
    const daily = buildHistory(model, stock.id, '1d', 520, FIXED_NOW);
    expect(daily.length).toBeGreaterThanOrEqual(252);
    for (const c of daily) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.volume).toBeGreaterThan(0);
    }
    for (let i = 1; i < daily.length; i++)
      expect(daily[i]!.time).toBeGreaterThan(daily[i - 1]!.time);
    expect(daily.at(-1)!.close).toBeCloseTo(stock.price, 2);
    expect(daily.at(-1)!.high).toBeCloseTo(stock.dayHigh, 2);
  });

  it('is deterministic and covers every interval', () => {
    const id = model.stocks[5]!.id;
    expect(buildHistory(model, id, '1d', 300, FIXED_NOW)).toEqual(
      buildHistory(model, id, '1d', 300, FIXED_NOW),
    );
    expect(buildHistory(model, id, '1w', 260, FIXED_NOW).length).toBe(260);
    expect(buildHistory(model, id, '5m', undefined, FIXED_NOW).length).toBeGreaterThan(0);
    expect(buildHistory(model, id, '15m', undefined, FIXED_NOW).length).toBeGreaterThan(75);
    expect(buildHistory(model, 99_999, '1d')).toEqual([]);
  });
});
