import { describe, expect, it } from 'vitest';
import {
  buildOverview,
  capAtRank,
  categoryForRank,
  generateMarket,
  resolveAsOf,
  toUniverse,
  UNIVERSE_SIZE,
} from '@/lib/mockDataGenerator';
import { aggregateColumnsFromStocks } from '@/lib/mockDataGenerator';
import {
  computeBreadth,
  computeDistribution,
  computeMovers,
  DISTRIBUTION_BUCKETS,
} from '@/lib/market/aggregates';
import { LENDER_INDUSTRIES, NO_LEVERAGE_INDUSTRIES } from '@/lib/market/sectors';
import { isinCheckDigit, makeIsin } from '@/lib/market/names';
import { indexMembershipMask, membershipsFromMask } from '@/lib/market/indices';
import { applyQuote, bollingerZoneFor, peFor, percentBFor } from '@/lib/stockFields';
import { decodeUniverse, encodeUniverse } from '@/lib/universeCodec';
import { FIXED_AS_OF, FIXED_NOW, fullMarket, market } from '../fixtures/market';

const model = fullMarket();
const stocks = model.stocks;

describe('universe', () => {
  it('has 5,000+ unique securities on both exchanges', () => {
    expect(stocks).toHaveLength(UNIVERSE_SIZE);
    expect(UNIVERSE_SIZE).toBeGreaterThanOrEqual(5000);
    expect(new Set(stocks.map(s => s.symbol)).size).toBe(stocks.length);
    expect(new Set(stocks.map(s => s.isin)).size).toBe(stocks.length);
    expect(new Set(stocks.map(s => s.exchange))).toEqual(new Set(['NSE', 'BSE']));
    expect(new Set(stocks.map(s => s.sector)).size).toBeGreaterThanOrEqual(20);
    stocks.forEach((s, i) => expect(s.id).toBe(i));
  });

  it('is deterministic for a given session', () => {
    const again = generateMarket({ count: 300, asOf: FIXED_AS_OF, now: FIXED_NOW });
    expect(again.meta.version).toBe(market(300).meta.version);
    expect(JSON.stringify(again.stocks.slice(0, 50))).toBe(
      JSON.stringify(market(300).stocks.slice(0, 50)),
    );
    const otherDay = generateMarket({ count: 300, asOf: '2026-09-30', now: FIXED_NOW });
    expect(otherDay.meta.version).not.toBe(again.meta.version);
    expect(resolveAsOf('2026-10-01').iso).toBe('2026-10-01');
  });

  it('issues ISINs whose check digits follow ISO 6166', () => {
    // Real ISINs: Reliance, Infosys, TCS.
    expect(isinCheckDigit('INE002A0101')).toBe(8);
    expect(isinCheckDigit('INE009A0102')).toBe(1);
    expect(isinCheckDigit('INE467B0102')).toBe(9);
    for (const s of stocks.slice(0, 500)) {
      expect(s.isin).toMatch(/^INE[0-9]{3}[A-Z]01[0-9]{2}[0-9]$/);
      expect(Number(s.isin.at(-1))).toBe(isinCheckDigit(s.isin.slice(0, -1)));
    }
    expect(makeIsin(0)).toHaveLength(12);
  });

  it('classifies market caps by rank, as SEBI does', () => {
    // Ranks are 1-based: 1–100 large, 101–250 mid, 251–1000 small.
    expect(categoryForRank(1)).toBe('Large Cap');
    expect(categoryForRank(100)).toBe('Large Cap');
    expect(categoryForRank(101)).toBe('Mid Cap');
    expect(categoryForRank(250)).toBe('Mid Cap');
    expect(categoryForRank(251)).toBe('Small Cap');
    expect(categoryForRank(1001)).toBe('Micro Cap');
    expect(capAtRank(0)).toBeGreaterThan(capAtRank(100));
    expect(capAtRank(100)).toBeGreaterThan(capAtRank(1000));
    const large = stocks.filter(s => s.marketCapCategory === 'Large Cap').length;
    expect(large).toBe(100);
    for (let i = 1; i < 300; i++)
      expect(stocks[i - 1]!.marketCap).toBeGreaterThanOrEqual(stocks[i]!.marketCap * 0.8);
  });

  it('assigns index memberships of the right size', () => {
    const count = (name: string): number => stocks.filter(s => s.indices.includes(name)).length;
    expect(count('NIFTY 50')).toBe(50);
    expect(count('SENSEX')).toBe(30);
    expect(count('NIFTY 500')).toBe(500);
    expect(count('BANK NIFTY')).toBe(12);
    expect(count('NIFTY IT')).toBe(10);
    expect(membershipsFromMask(indexMembershipMask(['NIFTY 50', 'SENSEX']))).toEqual([
      'NIFTY 50',
      'SENSEX',
    ]);
  });
});

describe('every record is internally consistent', () => {
  it('prices sit inside the day and 52-week ranges; changes add up', () => {
    for (const s of stocks) {
      expect(s.dayLow).toBeLessThanOrEqual(s.price + 1e-9);
      expect(s.dayHigh).toBeGreaterThanOrEqual(s.price - 1e-9);
      expect(s.week52Low).toBeLessThanOrEqual(s.dayLow + 1e-9);
      expect(s.week52High).toBeGreaterThanOrEqual(s.dayHigh - 1e-9);
      expect(s.change).toBeCloseTo(s.price - s.previousClose, 1);
      expect(s.volume).toBeGreaterThan(0);
    }
  });

  it('derives ratios the way an analyst would', () => {
    for (const s of stocks) {
      if (s.eps > 0) expect(s.pe).toBeCloseTo(s.price / s.eps, 1);
      else expect(s.pe).toBeNull();
      expect(s.marketCap).toBeCloseTo(s.sharesOutstanding * s.price, -1);
      expect(s.dividendYield).toBeCloseTo((s.dividendPerShare / s.price) * 100, 1);
      expect(s.rsi14).toBeGreaterThanOrEqual(0);
      expect(s.rsi14).toBeLessThanOrEqual(100);
      expect(s.promoterHolding + s.fiiHolding + s.diiHolding + s.publicHolding).toBeCloseTo(100, 1);
      expect(s.trendState).toBe(s.sma50 >= s.sma200 ? 'GOLDEN' : 'DEATH');
      // Leverage is not meaningful for banks and insurers; NBFCs do report it.
      if (NO_LEVERAGE_INDUSTRIES.has(s.industry)) expect(s.debtToEquity).toBeNull();
      if (LENDER_INDUSTRIES.has(s.industry)) expect(s.operatingMargin).toBeNull();
    }
  });

  it('has plausible, not random, distributions', () => {
    const median = (xs: number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const pes = stocks.flatMap(s => (s.pe === null ? [] : [s.pe]));
    expect(median(pes)).toBeGreaterThan(10);
    expect(median(pes)).toBeLessThan(60);
    const lossMakers = stocks.filter(s => s.pe === null).length / stocks.length;
    expect(lossMakers).toBeGreaterThan(0.03);
    expect(lossMakers).toBeLessThan(0.3);
    expect(median(stocks.map(s => s.roe))).toBeGreaterThan(5);
    expect(median(stocks.map(s => s.roe))).toBeLessThan(25);
    expect(median(stocks.map(s => s.beta))).toBeGreaterThan(0.6);
    expect(median(stocks.map(s => s.beta))).toBeLessThan(1.4);
  });
});

describe('derived fields', () => {
  it('re-derives everything price-dependent when a quote arrives', () => {
    const s = stocks.find(x => x.eps > 0 && x.dividendPerShare > 0)!;
    const price = s.price * 1.1;
    const next = applyQuote(s, {
      price,
      dayHigh: s.week52High * 2,
      dayLow: s.dayLow,
      volume: s.volume * 2,
    });
    expect(next.price).toBe(price);
    expect(next.pe).toBeCloseTo(price / s.eps, 1);
    expect(next.dividendYield).toBeLessThan(s.dividendYield);
    expect(next.marketCap).toBeGreaterThan(s.marketCap);
    expect(next.week52High).toBe(s.week52High * 2);
    expect(next.relativeVolume).toBeCloseTo(s.relativeVolume * 2, 0);
    expect(s.price).not.toBe(price); // the original is untouched
  });

  it('places Bollinger %B into zones', () => {
    expect(bollingerZoneFor(1.2)).toBe('ABOVE_UPPER');
    expect(bollingerZoneFor(0.8)).toBe('NEAR_UPPER');
    expect(bollingerZoneFor(0.5)).toBe('UPPER_HALF');
    expect(bollingerZoneFor(0.2)).toBe('LOWER_HALF');
    expect(bollingerZoneFor(0)).toBe('NEAR_LOWER');
    expect(bollingerZoneFor(-0.1)).toBe('BELOW_LOWER');
    expect(percentBFor(15, 10, 20)).toBe(0.5);
    expect(percentBFor(15, 10, 10)).toBe(0.5);
    expect(peFor(100, 0)).toBeNull();
  });
});

describe('market overview', () => {
  const overview = buildOverview(model);

  it('accounts for every security in breadth, distribution and sectors', () => {
    const { breadth } = overview;
    expect(breadth.total).toBe(UNIVERSE_SIZE);
    expect(breadth.advancing + breadth.declining + breadth.unchanged).toBe(UNIVERSE_SIZE);
    expect(overview.distribution).toHaveLength(DISTRIBUTION_BUCKETS);
    expect(overview.distribution.reduce((a, b) => a + b, 0)).toBe(UNIVERSE_SIZE);
    expect(overview.sectors.reduce((a, s) => a + s.count, 0)).toBe(UNIVERSE_SIZE);
  });

  it('ranks movers among NIFTY 500 members (no illiquid micro-caps)', () => {
    const { gainers, losers, active } = overview.movers;
    expect(gainers).toHaveLength(5);
    const eligible = stocks.filter(s => s.indices.includes('NIFTY 500'));
    const bySymbol = new Map(stocks.map(s => [s.symbol, s]));
    for (const m of [...gainers, ...losers, ...active])
      expect(bySymbol.get(m.symbol)!.indices).toContain('NIFTY 500');
    const pct = (s: (typeof stocks)[number]): number =>
      ((s.price - s.previousClose) / s.previousClose) * 100;
    expect(gainers[0]!.changePercent).toBeCloseTo(Math.max(...eligible.map(pct)), 6);
    expect(losers[0]!.changePercent).toBeCloseTo(Math.min(...eligible.map(pct)), 6);
    for (let i = 1; i < 5; i++) {
      expect(gainers[i - 1]!.changePercent).toBeGreaterThanOrEqual(gainers[i]!.changePercent);
      expect(losers[i - 1]!.changePercent).toBeLessThanOrEqual(losers[i]!.changePercent);
      expect(active[i - 1]!.turnover).toBeGreaterThanOrEqual(active[i]!.turnover);
    }
  });

  it('computes the same aggregates from any stock list', () => {
    const cols = aggregateColumnsFromStocks(stocks.slice(0, 100));
    const breadth = computeBreadth(cols);
    expect(breadth.total).toBe(100);
    expect(computeDistribution(cols).reduce((a, b) => a + b, 0)).toBe(100);
    expect(computeMovers(cols, 3).gainers).toHaveLength(3);
  });

  it('carries index levels with intraday and daily history', () => {
    const nifty = overview.indices.find(i => i.id === 'NIFTY50')!;
    expect(nifty.history.length).toBeGreaterThanOrEqual(60);
    expect(nifty.intraday.length).toBeGreaterThan(0);
    expect(nifty.change).toBeCloseTo(nifty.value - nifty.previousClose, 1);
  });
});

describe('compact universe codec', () => {
  it('round-trips every field exactly, at a fraction of the JSON size', () => {
    const universe = toUniverse(model);
    const compact = encodeUniverse(universe);
    const decoded = decodeUniverse(JSON.parse(JSON.stringify(compact)));
    expect(decoded.meta).toEqual(universe.meta);
    // A computed −0 (a −0.001 change, rounded) and 0 are the same value on the
    // wire and on screen; toEqual would otherwise tell them apart.
    const plain = (s: object): Record<string, unknown> =>
      Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === 0 ? 0 : v]));
    expect(decoded.stocks.map(plain)).toEqual(universe.stocks.map(plain));
    const ratio = JSON.stringify(compact).length / JSON.stringify(universe.stocks).length;
    expect(ratio).toBeLessThan(0.6);
  });

  it('rejects a payload in an unknown format', () => {
    const compact = encodeUniverse(toUniverse(market(40)));
    expect(() =>
      decodeUniverse({ ...compact, format: 'something-else' } as unknown as typeof compact),
    ).toThrow();
  });
});
