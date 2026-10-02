import type { Stock } from '@/types/market';
import type { Unit } from '@/types/filters';

/**
 * Every field the filter engine can evaluate, with its storage kind.
 * The column store, the expression validator, the custom builder and the
 * sorter all read this one registry.
 */

export type FieldKind = 'number' | 'category' | 'set' | 'boolean' | 'text' | 'context';

export interface FieldMeta {
  key: string;
  kind: FieldKind;
  label: string;
  unit: Unit;
  /** Changes with live ticks. */
  live?: boolean;
}

type NumericStockKey = {
  [K in keyof Stock]: Stock[K] extends number | null ? K : never;
}[keyof Stock];

const num = (key: NumericStockKey, label: string, unit: Unit, live = false): FieldMeta => ({
  key,
  kind: 'number',
  label,
  unit,
  live,
});

export const NUMERIC_FIELD_LIST: readonly FieldMeta[] = [
  num('price', 'Price', 'inr', true),
  num('previousClose', 'Previous Close', 'inr'),
  num('open', 'Open', 'inr'),
  num('dayHigh', 'Day High', 'inr', true),
  num('dayLow', 'Day Low', 'inr', true),
  num('change', 'Change', 'inr', true),
  num('changePercent', 'Change %', 'pct', true),
  num('volume', 'Volume', 'shares', true),
  num('avgVolume', 'Avg Volume (20D)', 'shares'),
  num('relativeVolume', 'Volume vs Avg', 'x', true),
  num('turnover', 'Turnover', 'cr', true),
  num('week52High', '52W High', 'inr', true),
  num('week52Low', '52W Low', 'inr', true),
  num('pctFrom52High', 'Below 52W High', 'pct', true),
  num('pctFrom52Low', 'Above 52W Low', 'pct', true),
  num('return1W', 'Return 1W', 'pct'),
  num('return1M', 'Return 1M', 'pct'),
  num('return3M', 'Return 3M', 'pct'),
  num('return6M', 'Return 6M', 'pct'),
  num('return1Y', 'Return 1Y', 'pct'),
  num('marketCap', 'Market Cap', 'cr', true),
  num('sharesOutstanding', 'Shares Outstanding', 'plain'),
  num('faceValue', 'Face Value', 'inr'),
  num('pe', 'P/E', 'plain', true),
  num('pb', 'P/B', 'plain', true),
  num('eps', 'EPS (TTM)', 'inr'),
  num('bookValue', 'Book Value', 'inr'),
  num('dividendPerShare', 'Dividend / Share', 'inr'),
  num('roe', 'ROE', 'pct'),
  num('roce', 'ROCE', 'pct'),
  num('debtToEquity', 'Debt / Equity', 'plain'),
  num('dividendYield', 'Dividend Yield', 'pct', true),
  num('revenueGrowth', 'Revenue Growth', 'pct'),
  num('profitGrowth', 'Profit Growth', 'pct'),
  num('operatingMargin', 'Operating Margin', 'pct'),
  num('netMargin', 'Net Margin', 'pct'),
  num('pegRatio', 'PEG Ratio', 'plain', true),
  num('evToEbitda', 'EV / EBITDA', 'x'),
  num('currentRatio', 'Current Ratio', 'x'),
  num('interestCoverage', 'Interest Coverage', 'x'),
  num('promoterHolding', 'Promoter Holding', 'pct'),
  num('fiiHolding', 'FII Holding', 'pct'),
  num('diiHolding', 'DII Holding', 'pct'),
  num('publicHolding', 'Public Holding', 'pct'),
  num('pledgedPercent', 'Promoter Pledge', 'pct'),
  num('sma20', 'SMA 20', 'inr'),
  num('sma50', 'SMA 50', 'inr'),
  num('sma200', 'SMA 200', 'inr'),
  num('ema12', 'EMA 12', 'inr'),
  num('ema26', 'EMA 26', 'inr'),
  num('rsi14', 'RSI (14)', 'plain'),
  num('macd', 'MACD', 'plain'),
  num('macdSignal', 'MACD Signal', 'plain'),
  num('macdHistogram', 'MACD Histogram', 'plain'),
  num('bbUpper', 'Bollinger Upper', 'inr'),
  num('bbMiddle', 'Bollinger Middle', 'inr'),
  num('bbLower', 'Bollinger Lower', 'inr'),
  num('bbPercentB', 'Bollinger %B', 'plain', true),
  num('atr14', 'ATR (14)', 'inr'),
  num('atrPercent', 'ATR %', 'pct', true),
  num('beta', 'Beta', 'plain'),
  num('volatility', 'Volatility (60D)', 'pct'),
  num('priceVsSma20', 'Price vs SMA 20', 'pct', true),
  num('priceVsSma50', 'Price vs SMA 50', 'pct', true),
  num('priceVsSma200', 'Price vs SMA 200', 'pct', true),
];

export const CATEGORY_FIELD_LIST: readonly FieldMeta[] = [
  { key: 'exchange', kind: 'category', label: 'Exchange', unit: 'plain' },
  { key: 'sector', kind: 'category', label: 'Sector', unit: 'plain' },
  { key: 'industry', kind: 'category', label: 'Industry', unit: 'plain' },
  { key: 'marketCapCategory', kind: 'category', label: 'Market Cap Class', unit: 'plain' },
  { key: 'macdState', kind: 'category', label: 'MACD State', unit: 'plain' },
  { key: 'bbZone', kind: 'category', label: 'Bollinger Zone', unit: 'plain', live: true },
  { key: 'trendState', kind: 'category', label: 'SMA 50 / 200', unit: 'plain' },
];

/** Derived flags, stored as 0/1 numeric columns. */
export const BOOLEAN_FIELDS: Record<string, { label: string; test: (s: Stock) => boolean }> = {
  isProfitable: { label: 'Profitable', test: s => s.eps > 0 },
  paysDividend: { label: 'Pays Dividend', test: s => s.dividendPerShare > 0 },
  debtFree: { label: 'Debt Free', test: s => s.debtToEquity !== null && s.debtToEquity < 0.05 },
  promoterPledge: { label: 'Promoter Pledge', test: s => s.pledgedPercent > 0 },
};

export const FIELD_META: ReadonlyMap<string, FieldMeta> = new Map<string, FieldMeta>([
  ...NUMERIC_FIELD_LIST.map(f => [f.key, f] as const),
  ...CATEGORY_FIELD_LIST.map(f => [f.key, f] as const),
  ['indices', { key: 'indices', kind: 'set', label: 'Index Membership', unit: 'plain' }],
  ...Object.entries(BOOLEAN_FIELDS).map(
    ([key, b]) => [key, { key, kind: 'boolean', label: b.label, unit: 'plain' }] as const,
  ),
  ['search', { key: 'search', kind: 'text', label: 'Search', unit: 'plain' }],
  ['watchlist', { key: 'watchlist', kind: 'context', label: 'In Watchlist', unit: 'plain' }],
]);

export const fieldKind = (field: string): FieldKind | undefined => FIELD_META.get(field)?.kind;

export const isLiveField = (field: string | undefined): boolean =>
  field !== undefined && FIELD_META.get(field)?.live === true;

/** Fixed vocabularies, so live changes never grow a dictionary mid-session. */
export const ENUM_VALUES: Record<string, readonly string[]> = {
  exchange: ['NSE', 'BSE'],
  marketCapCategory: ['Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap'],
  macdState: ['BULLISH_CROSS', 'BULLISH', 'NEUTRAL', 'BEARISH', 'BEARISH_CROSS'],
  bbZone: ['ABOVE_UPPER', 'NEAR_UPPER', 'UPPER_HALF', 'LOWER_HALF', 'NEAR_LOWER', 'BELOW_LOWER'],
  trendState: ['GOLDEN', 'DEATH'],
};
