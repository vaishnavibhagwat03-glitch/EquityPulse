import type { Universe, UniverseMeta } from '@/types/market';
import { indexMembershipMask, membershipsFromMask } from './market/indices';
import { deriveInto, type StockBase } from './stockFields';

/**
 * Compact, columnar wire format for the full universe.
 *
 * Full JSON objects cost ~1.45 KB per stock (7.6 MB for 5,247). The compact
 * form sends only base fields, one array per field (columns compress ~18%
 * better than row tuples because similar values sit together), dictionary-
 * encodes categorical columns, packs index membership into a bitmask, and
 * lets the client re-derive every price-dependent field with `deriveInto`.
 * Decoding is by field name, so adding or reordering fields is safe.
 */

export const COMPACT_FORMAT = 'equitypulse.columns.v1';

/** Every StockBase field except `id` (row position) and `bbMiddle` (= SMA 20). */
export const COMPACT_FIELDS = [
  'symbol',
  'name',
  'exchange',
  'isin',
  'sector',
  'industry',
  'marketCapCategory',
  'indices',
  'price',
  'previousClose',
  'open',
  'dayHigh',
  'dayLow',
  'volume',
  'avgVolume',
  'week52High',
  'week52Low',
  'return1W',
  'return1M',
  'return3M',
  'return6M',
  'return1Y',
  'sharesOutstanding',
  'faceValue',
  'eps',
  'bookValue',
  'dividendPerShare',
  'roe',
  'roce',
  'debtToEquity',
  'revenueGrowth',
  'profitGrowth',
  'operatingMargin',
  'netMargin',
  'evToEbitda',
  'currentRatio',
  'interestCoverage',
  'promoterHolding',
  'fiiHolding',
  'diiHolding',
  'pledgedPercent',
  'sma20',
  'sma50',
  'sma200',
  'ema12',
  'ema26',
  'rsi14',
  'macd',
  'macdSignal',
  'macdState',
  'bbUpper',
  'bbLower',
  'atr14',
  'beta',
  'volatility',
  'spark',
] as const satisfies readonly Exclude<keyof StockBase, 'id' | 'bbMiddle'>[];

const DICTIONARY_FIELDS = [
  'exchange',
  'sector',
  'industry',
  'marketCapCategory',
  'macdState',
] as const;
type DictionaryField = (typeof DICTIONARY_FIELDS)[number];
const isDictionaryField = (f: string): f is DictionaryField =>
  (DICTIONARY_FIELDS as readonly string[]).includes(f);

export type CompactCell = string | number | null;

export interface CompactUniverse {
  format: typeof COMPACT_FORMAT;
  meta: UniverseMeta;
  count: number;
  dictionaries: Record<DictionaryField, string[]>;
  /** Field name → one value per stock, in universe order. */
  columns: Record<string, CompactCell[]>;
}

export function encodeUniverse(universe: Universe): CompactUniverse {
  const dictionaries = {} as Record<DictionaryField, string[]>;
  const columns: Record<string, CompactCell[]> = {};
  const stocks = universe.stocks;

  for (const field of COMPACT_FIELDS) {
    if (field === 'indices') {
      columns[field] = stocks.map(s => indexMembershipMask(s.indices));
    } else if (isDictionaryField(field)) {
      const dictionary: string[] = [];
      const lookup = new Map<string, number>();
      columns[field] = stocks.map(s => {
        const value = s[field];
        let code = lookup.get(value);
        if (code === undefined) {
          code = dictionary.length;
          dictionary.push(value);
          lookup.set(value, code);
        }
        return code;
      });
      dictionaries[field] = dictionary;
    } else {
      columns[field] = stocks.map(s => s[field] as CompactCell);
    }
  }
  return {
    format: COMPACT_FORMAT,
    meta: universe.meta,
    count: stocks.length,
    dictionaries,
    columns,
  };
}

export function decodeUniverse(compact: CompactUniverse): Universe {
  if (compact.format !== COMPACT_FORMAT) {
    throw new Error(`Unsupported universe format: ${String(compact.format)}`);
  }
  const missing = COMPACT_FIELDS.filter(f => !Array.isArray(compact.columns[f]));
  if (missing.length) throw new Error(`Universe payload is missing fields: ${missing.join(', ')}`);

  const n = compact.count;
  const bases: Record<string, unknown>[] = new Array(n);
  for (let id = 0; id < n; id++) bases[id] = { id };

  for (const field of COMPACT_FIELDS) {
    const column = compact.columns[field]!;
    if (field === 'indices') {
      for (let id = 0; id < n; id++)
        bases[id]![field] = membershipsFromMask(Number(column[id] ?? 0));
    } else if (isDictionaryField(field)) {
      const dictionary = compact.dictionaries[field] ?? [];
      for (let id = 0; id < n; id++) bases[id]![field] = dictionary[Number(column[id])] ?? '';
    } else {
      for (let id = 0; id < n; id++) bases[id]![field] = column[id] ?? null;
    }
  }

  const stocks = bases.map(base => {
    base.bbMiddle = base.sma20;
    return deriveInto(base as unknown as StockBase);
  });
  return { meta: compact.meta, stocks };
}
