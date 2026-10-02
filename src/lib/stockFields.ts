import type { BollingerZone, Stock } from '@/types/market';

/**
 * Derived stock fields — the single definition of every value that is a
 * function of other values (mostly of price).
 *
 * The generator, the API codec and the live update path all go through
 * `deriveStock`, so a P/E shown in the grid, filtered on by the engine and
 * served by the API can never disagree. When a tick moves the price, these are
 * exactly the fields that move with it.
 */

export const DERIVED_KEYS = [
  'change',
  'changePercent',
  'relativeVolume',
  'turnover',
  'pctFrom52High',
  'pctFrom52Low',
  'marketCap',
  'pe',
  'pb',
  'dividendYield',
  'pegRatio',
  'priceVsSma20',
  'priceVsSma50',
  'priceVsSma200',
  'bbPercentB',
  'bbZone',
  'atrPercent',
  'trendState',
  'macdHistogram',
  'publicHolding',
] as const satisfies readonly (keyof Stock)[];

export type DerivedKey = (typeof DERIVED_KEYS)[number];
export type StockBase = Omit<Stock, DerivedKey>;

/** Fields whose value changes when a live tick arrives. */
export const LIVE_KEYS = [
  'price',
  'dayHigh',
  'dayLow',
  'volume',
  'week52High',
  'week52Low',
  'change',
  'changePercent',
  'relativeVolume',
  'turnover',
  'pctFrom52High',
  'pctFrom52Low',
  'marketCap',
  'pe',
  'pb',
  'dividendYield',
  'pegRatio',
  'priceVsSma20',
  'priceVsSma50',
  'priceVsSma200',
  'bbPercentB',
  'bbZone',
  'atrPercent',
] as const satisfies readonly (keyof Stock)[];

export const LIVE_KEY_SET: ReadonlySet<string> = new Set(LIVE_KEYS);

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const pctDiff = (a: number, b: number): number => (b ? r2((a / b - 1) * 100) : 0);

export function bollingerZoneFor(percentB: number): BollingerZone {
  if (percentB > 1) return 'ABOVE_UPPER';
  if (percentB >= 0.8) return 'NEAR_UPPER';
  if (percentB >= 0.5) return 'UPPER_HALF';
  if (percentB >= 0.2) return 'LOWER_HALF';
  if (percentB >= 0) return 'NEAR_LOWER';
  return 'BELOW_LOWER';
}

export function peFor(price: number, eps: number): number | null {
  return eps > 0 ? r2(price / eps) : null;
}

export function percentBFor(price: number, lower: number, upper: number): number {
  const span = upper - lower;
  return span > 0 ? r3((price - lower) / span) : 0.5;
}

/**
 * Writes every derived field onto `target` and returns it as a Stock.
 * Mutates — used by the decoder, which owns freshly built objects and would
 * otherwise copy 5,000+ eighty-field records a second time.
 */
export function deriveInto(target: StockBase): Stock {
  const b = target as Stock;
  const price = b.price;
  const pe = peFor(price, b.eps);
  const percentB = percentBFor(price, b.bbLower, b.bbUpper);
  b.change = r2(price - b.previousClose);
  b.changePercent = pctDiff(price, b.previousClose);
  b.relativeVolume = b.avgVolume > 0 ? r2(b.volume / b.avgVolume) : 0;
  b.turnover = r2((price * b.volume) / 1e7);
  b.pctFrom52High =
    b.week52High > 0 ? r2(Math.max(0, (b.week52High - price) / b.week52High) * 100) : 0;
  b.pctFrom52Low = b.week52Low > 0 ? r2(Math.max(0, (price - b.week52Low) / b.week52Low) * 100) : 0;
  b.marketCap = Math.round(b.sharesOutstanding * price);
  b.pe = pe;
  b.pb = b.bookValue > 0 ? r2(price / b.bookValue) : 0;
  b.dividendYield = price > 0 ? r2((b.dividendPerShare / price) * 100) : 0;
  b.pegRatio = pe !== null && b.profitGrowth > 1 ? r2(pe / b.profitGrowth) : null;
  b.priceVsSma20 = pctDiff(price, b.sma20);
  b.priceVsSma50 = pctDiff(price, b.sma50);
  b.priceVsSma200 = pctDiff(price, b.sma200);
  b.bbPercentB = percentB;
  b.bbZone = bollingerZoneFor(percentB);
  b.atrPercent = price > 0 ? r2((b.atr14 / price) * 100) : 0;
  b.trendState = b.sma50 >= b.sma200 ? 'GOLDEN' : 'DEATH';
  b.macdHistogram = r3(b.macd - b.macdSignal);
  b.publicHolding = r2(100 - b.promoterHolding - b.fiiHolding - b.diiHolding);
  return b;
}

/** Non-mutating variant: derives onto a copy. */
export function deriveStock(b: StockBase): Stock {
  return deriveInto({ ...b });
}

/** Applies a live quote to a stock, re-deriving everything price-dependent. */
export function applyQuote(
  stock: Stock,
  quote: { price: number; dayHigh: number; dayLow: number; volume: number },
): Stock {
  return deriveStock({
    ...stock,
    price: quote.price,
    dayHigh: quote.dayHigh,
    dayLow: quote.dayLow,
    volume: quote.volume,
    week52High: Math.max(stock.week52High, quote.dayHigh),
    week52Low: Math.min(stock.week52Low, quote.dayLow),
  });
}
