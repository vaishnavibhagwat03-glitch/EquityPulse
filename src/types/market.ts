/**
 * Core market domain types. Shared by the generator, the API, the feed engine
 * (server and worker), the filter engine and the UI.
 */

export type Exchange = 'NSE' | 'BSE';

export type MarketCapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap' | 'Micro Cap';

export type MacdState = 'BULLISH_CROSS' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'BEARISH_CROSS';

export type BollingerZone =
  'ABOVE_UPPER' | 'NEAR_UPPER' | 'UPPER_HALF' | 'LOWER_HALF' | 'NEAR_LOWER' | 'BELOW_LOWER';

export type TrendState = 'GOLDEN' | 'DEATH';

/** A security as served by `/api/stocks`. Values are as of the snapshot. */
export interface Stock {
  /** Position in the universe. Stable for a given universe version. */
  id: number;
  symbol: string;
  name: string;
  exchange: Exchange;
  isin: string;
  sector: string;
  industry: string;
  marketCapCategory: MarketCapCategory;
  /** Index memberships, e.g. `NIFTY 50`, `SENSEX`. */
  indices: string[];

  // --- price snapshot -----------------------------------------------------
  price: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  change: number;
  changePercent: number;
  /** Shares traded today. */
  volume: number;
  /** 20-session average daily volume (shares). */
  avgVolume: number;
  /** volume / avgVolume. */
  relativeVolume: number;
  /** Today's traded value, ₹ crore. */
  turnover: number;
  week52High: number;
  week52Low: number;
  /** % below the 52-week high (≥ 0). */
  pctFrom52High: number;
  /** % above the 52-week low (≥ 0). */
  pctFrom52Low: number;
  return1W: number;
  return1M: number;
  return3M: number;
  return6M: number;
  return1Y: number;

  // --- fundamentals -------------------------------------------------------
  /** ₹ crore, at the snapshot price. */
  marketCap: number;
  /** Crore shares. */
  sharesOutstanding: number;
  faceValue: number;
  /** Trailing P/E. `null` when earnings are negative. */
  pe: number | null;
  pb: number;
  /** Trailing-twelve-month EPS, ₹. */
  eps: number;
  bookValue: number;
  /** Trailing dividend per share, ₹. Yield is derived from it at the live price. */
  dividendPerShare: number;
  roe: number;
  roce: number;
  /** `null` where leverage is not meaningful (banks, insurers). */
  debtToEquity: number | null;
  dividendYield: number;
  /** YoY, %. */
  revenueGrowth: number;
  /** YoY, %. */
  profitGrowth: number;
  /** `null` for lenders, where operating margin is not reported. */
  operatingMargin: number | null;
  netMargin: number;
  /** `null` when P/E is undefined or growth is non-positive. */
  pegRatio: number | null;
  evToEbitda: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  promoterHolding: number;
  fiiHolding: number;
  diiHolding: number;
  publicHolding: number;
  /** % of promoter shares pledged. */
  pledgedPercent: number;

  // --- technicals (daily) -------------------------------------------------
  sma20: number;
  sma50: number;
  sma200: number;
  ema12: number;
  ema26: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdState: MacdState;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  /** Bollinger %B: 0 = lower band, 1 = upper band. */
  bbPercentB: number;
  bbZone: BollingerZone;
  atr14: number;
  /** ATR as % of price. */
  atrPercent: number;
  /** Estimated against the market factor over 252 sessions. */
  beta: number;
  /** Annualised volatility of daily log returns over 60 sessions, %. */
  volatility: number;
  /** % distance of price from SMA 20 / 50 / 200. */
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  /** SMA 50 vs SMA 200. */
  trendState: TrendState;

  /** 1-month closing trend, quantised (see `lib/sparkline.ts`). */
  spark: string;
}

/** Fields the live feed updates. Everything else is static for the session. */
export interface LiveQuote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  /** Direction of the most recent tick: 1 up, -1 down, 0 unchanged. */
  direction: 1 | -1 | 0;
  /** Feed timestamp of the last update (epoch ms). */
  ts: number;
  /** performance.now() at receipt, for receipt-to-render latency. */
  rx: number;
}

export interface Candle {
  /** Epoch seconds (UTC), the bar's open time. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y';

export type HistoryInterval = '5m' | '15m' | '1d' | '1w';

export interface IndexDefinition {
  id: string;
  name: string;
  /** Short label for compact UI. */
  short: string;
  exchange: Exchange;
  /** Index level at the previous close. */
  base: number;
}

export interface IndexSnapshot extends IndexDefinition {
  value: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  constituents: { symbol: string; shares: number }[];
  /** Intraday level, one point per 5 minutes. */
  intraday: number[];
  /** Daily closes, last 60 sessions. */
  history: number[];
  advancing: number;
  declining: number;
}

export interface SectorSummary {
  name: string;
  count: number;
  marketCap: number;
  /** Market-cap weighted change, %. */
  changePercent: number;
  advancing: number;
  declining: number;
  industries: string[];
}

export interface MarketBreadth {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  newHighs: number;
  newLows: number;
  /** Shares traded across the universe. */
  volume: number;
  /** ₹ crore traded across the universe. */
  turnover: number;
}

export interface Mover {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  turnover: number;
}

export interface MarketMovers {
  gainers: Mover[];
  losers: Mover[];
  active: Mover[];
}

export interface MarketOverview {
  asOf: number;
  breadth: MarketBreadth;
  indices: Omit<IndexSnapshot, 'constituents'>[];
  sectors: SectorSummary[];
  movers: MarketMovers;
  /** Count of stocks per 0.5% day-change bucket from −5% to +5% (tails clamped). */
  distribution: number[];
}

export interface UniverseMeta {
  /** Changes whenever the generated dataset changes. */
  version: string;
  seed: number;
  /** ISO date of the snapshot session. */
  asOf: string;
  count: number;
  generatedMs: number;
}

export interface Universe {
  meta: UniverseMeta;
  stocks: Stock[];
}

export interface QuarterlyResult {
  period: string;
  revenue: number;
  operatingProfit: number;
  netProfit: number;
  eps: number;
}

export interface ShareholdingPoint {
  period: string;
  promoter: number;
  fii: number;
  dii: number;
  public: number;
}

export interface Fundamentals {
  symbol: string;
  /** ₹ crore, trailing twelve months. */
  revenueTTM: number;
  netProfitTTM: number;
  ebitdaTTM: number;
  totalDebt: number;
  cash: number;
  enterpriseValue: number;
  quarterly: QuarterlyResult[];
  annual: { year: string; revenue: number; netProfit: number; roe: number }[];
  shareholding: ShareholdingPoint[];
  about: string;
}
