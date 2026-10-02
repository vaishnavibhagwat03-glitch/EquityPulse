import type { MarketBreadth, MarketMovers, Mover, SectorSummary } from '@/types/market';

/**
 * Whole-market reductions shared by the static snapshot (server) and the live
 * feed engine (worker / ws server). Inputs are column arrays so the engine can
 * pass its live typed arrays without building objects.
 */

export interface AggregateColumns {
  size: number;
  symbol: readonly string[];
  name: readonly string[];
  sector: readonly string[];
  price: ArrayLike<number>;
  previousClose: ArrayLike<number>;
  volume: ArrayLike<number>;
  /** Crore shares outstanding. */
  shares: ArrayLike<number>;
  dayHigh: ArrayLike<number>;
  dayLow: ArrayLike<number>;
  week52High: ArrayLike<number>;
  week52Low: ArrayLike<number>;
  /** 1 when the stock is eligible for the movers lists (e.g. NIFTY 500). */
  moverEligible: ArrayLike<number>;
}

/** Threshold, in percent, below which a stock counts as unchanged. */
export const UNCHANGED_BAND = 0.05;

export function computeBreadth(c: AggregateColumns): MarketBreadth {
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let newHighs = 0;
  let newLows = 0;
  let volume = 0;
  let turnover = 0;
  for (let i = 0; i < c.size; i++) {
    const p = c.price[i]!;
    const pc = c.previousClose[i]!;
    const chg = ((p - pc) / pc) * 100;
    if (chg > UNCHANGED_BAND) advancing++;
    else if (chg < -UNCHANGED_BAND) declining++;
    else unchanged++;
    // A new 52-week extreme printed during today's session.
    if (c.dayHigh[i]! >= c.week52High[i]!) newHighs++;
    if (c.dayLow[i]! <= c.week52Low[i]!) newLows++;
    volume += c.volume[i]!;
    turnover += (p * c.volume[i]!) / 1e7;
  }
  return { advancing, declining, unchanged, total: c.size, newHighs, newLows, volume, turnover };
}

export function computeSectors(
  c: AggregateColumns,
  industriesBySector?: ReadonlyMap<string, readonly string[]>,
): SectorSummary[] {
  const acc = new Map<
    string,
    { count: number; cap: number; capPrev: number; adv: number; dec: number }
  >();
  for (let i = 0; i < c.size; i++) {
    const sector = c.sector[i]!;
    let e = acc.get(sector);
    if (!e) {
      e = { count: 0, cap: 0, capPrev: 0, adv: 0, dec: 0 };
      acc.set(sector, e);
    }
    const p = c.price[i]!;
    const pc = c.previousClose[i]!;
    const s = c.shares[i]!;
    e.count++;
    e.cap += s * p;
    e.capPrev += s * pc;
    const chg = ((p - pc) / pc) * 100;
    if (chg > UNCHANGED_BAND) e.adv++;
    else if (chg < -UNCHANGED_BAND) e.dec++;
  }
  return [...acc.entries()]
    .map(([name, e]) => ({
      name,
      count: e.count,
      marketCap: e.cap,
      changePercent: e.capPrev ? (e.cap / e.capPrev - 1) * 100 : 0,
      advancing: e.adv,
      declining: e.dec,
      industries: [...(industriesBySector?.get(name) ?? [])],
    }))
    .sort((a, b) => b.marketCap - a.marketCap);
}

/** Top-k selection without sorting the whole universe. */
function topK(c: AggregateColumns, k: number, score: (i: number) => number): number[] {
  const picked: { i: number; s: number }[] = [];
  for (let i = 0; i < c.size; i++) {
    if (!c.moverEligible[i]) continue;
    const s = score(i);
    if (picked.length < k) {
      picked.push({ i, s });
      picked.sort((a, b) => b.s - a.s);
    } else if (s > picked[k - 1]!.s) {
      picked[k - 1] = { i, s };
      picked.sort((a, b) => b.s - a.s);
    }
  }
  return picked.map(p => p.i);
}

function toMover(c: AggregateColumns, i: number): Mover {
  const p = c.price[i]!;
  const pc = c.previousClose[i]!;
  return {
    symbol: c.symbol[i]!,
    name: c.name[i]!,
    price: p,
    changePercent: ((p - pc) / pc) * 100,
    turnover: (p * c.volume[i]!) / 1e7,
  };
}

export function computeMovers(c: AggregateColumns, k = 5): MarketMovers {
  const chg = (i: number): number => (c.price[i]! - c.previousClose[i]!) / c.previousClose[i]!;
  return {
    gainers: topK(c, k, chg).map(i => toMover(c, i)),
    losers: topK(c, k, i => -chg(i)).map(i => toMover(c, i)),
    active: topK(c, k, i => c.price[i]! * c.volume[i]!).map(i => toMover(c, i)),
  };
}

/** Day-change histogram: 20 buckets of 0.5% from −5% to +5%, tails clamped. */
export const DISTRIBUTION_BUCKETS = 20;

export function computeDistribution(c: AggregateColumns): number[] {
  const out = new Array<number>(DISTRIBUTION_BUCKETS).fill(0);
  for (let i = 0; i < c.size; i++) {
    const chg = ((c.price[i]! - c.previousClose[i]!) / c.previousClose[i]!) * 100;
    const b = Math.min(DISTRIBUTION_BUCKETS - 1, Math.max(0, Math.floor((chg + 5) / 0.5)));
    out[b]!++;
  }
  return out;
}

export interface IndexComputation {
  /** Constituent positions in the column arrays. */
  members: readonly number[];
  base: number;
}

/** Index level from live prices; also returns constituent breadth. */
export function computeIndexLevel(
  c: AggregateColumns,
  index: IndexComputation,
): { value: number; changePercent: number; advancing: number; declining: number } {
  let now = 0;
  let prev = 0;
  let advancing = 0;
  let declining = 0;
  for (const i of index.members) {
    const s = c.shares[i]!;
    const p = c.price[i]!;
    const pc = c.previousClose[i]!;
    now += s * p;
    prev += s * pc;
    if (p > pc) advancing++;
    else if (p < pc) declining++;
  }
  const ratio = prev ? now / prev : 1;
  return {
    value: index.base * ratio,
    changePercent: (ratio - 1) * 100,
    advancing,
    declining,
  };
}
