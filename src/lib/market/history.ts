import type { Candle, HistoryInterval } from '@/types/market';
import type { MarketModel } from '@/lib/mockDataGenerator';
import { todaySessionWindow } from '@/lib/mockDataGenerator';
import { sessionOpenTs } from './calendar';
import {
  aggregateBars,
  dailyToCandles,
  FACTOR_DAYS,
  generateDaily,
  intradayBars,
  toWeekly,
} from './pricePath';

/**
 * OHLCV history for one stock, regenerated on demand from its deterministic
 * path. Any interval or length joins up exactly with the universe snapshot:
 * the last daily bar is today's open/high/low/LTP/volume.
 */

export const HISTORY_LIMITS: Record<HistoryInterval, { default: number; max: number }> = {
  '5m': { default: 75, max: 75 },
  '15m': { default: 125, max: 125 },
  '1d': { default: 500, max: FACTOR_DAYS - 20 },
  '1w': { default: 330, max: Math.floor((FACTOR_DAYS - 20) / 5) },
};

export function isHistoryInterval(value: string): value is HistoryInterval {
  return value === '5m' || value === '15m' || value === '1d' || value === '1w';
}

export function buildHistory(
  model: MarketModel,
  id: number,
  interval: HistoryInterval,
  limit?: number,
  now = Date.now(),
): Candle[] {
  const params = model.params[id];
  if (!params) return [];
  const bounds = HISTORY_LIMITS[interval];
  const n = Math.max(1, Math.min(bounds.max, Math.floor(limit ?? bounds.default)));

  switch (interval) {
    case '1d': {
      const daily = generateDaily(params, model.factors, n, model.asOfDay);
      return dailyToCandles(daily);
    }
    case '1w': {
      const daily = generateDaily(
        params,
        model.factors,
        Math.min(FACTOR_DAYS - 20, n * 5 + 5),
        model.asOfDay,
      );
      return toWeekly(dailyToCandles(daily)).slice(-n);
    }
    case '5m': {
      const daily = generateDaily(params, model.factors, 2, model.asOfDay);
      const window = todaySessionWindow(now);
      const today = barAt(daily, daily.length - 1);
      return intradayBars(params, 0, today, window.start, window.steps).slice(-n);
    }
    case '15m': {
      const sessions = 5;
      const daily = generateDaily(params, model.factors, sessions, model.asOfDay);
      const window = todaySessionWindow(now);
      const out: Candle[] = [];
      for (let i = 0; i < sessions; i++) {
        const t = sessions - 1 - i;
        const isToday = t === 0;
        const bars = intradayBars(
          params,
          t,
          barAt(daily, i),
          isToday ? window.start : sessionOpenTs(daily.days[i]!),
          isToday ? window.steps : 75,
        );
        out.push(...aggregateBars(bars, 3));
      }
      return out.slice(-n);
    }
  }
}

function barAt(
  daily: ReturnType<typeof generateDaily>,
  i: number,
): { open: number; high: number; low: number; close: number; volume: number } {
  return {
    open: daily.open[i]!,
    high: daily.high[i]!,
    low: daily.low[i]!,
    close: daily.close[i]!,
    volume: daily.volume[i]!,
  };
}
