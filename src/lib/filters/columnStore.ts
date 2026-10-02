import type { Stock } from '@/types/market';
import { indexMembershipMask } from '@/lib/market/indices';
import { BOOLEAN_FIELDS, CATEGORY_FIELD_LIST, ENUM_VALUES, NUMERIC_FIELD_LIST } from './fields';

/**
 * Columnar view of the universe for the filter engine and sorter.
 *
 * Objects are convenient for rendering but slow to scan: every predicate would
 * chase a pointer per row. Here each numeric field is one Float64Array (null →
 * NaN, which fails every comparison — exactly the null semantics we want),
 * each category is a Uint16Array of dictionary codes, and index membership is
 * a bitmask per row.
 */

export interface CategoryColumn {
  codes: Uint16Array;
  dictionary: string[];
  lookup: Map<string, number>;
}

export interface ColumnStore {
  size: number;
  /** Identifies the static dataset (universe version). */
  version: string;
  /** Bumped every time live columns are rewritten. */
  liveVersion: number;
  symbols: string[];
  names: string[];
  numbers: Map<string, Float64Array>;
  categories: Map<string, CategoryColumn>;
  sets: Map<string, Uint32Array>;
  /** Lower-cased "symbol name sector industry" per row. */
  search: string[];
}

export function buildColumnStore(stocks: readonly Stock[], version: string): ColumnStore {
  const size = stocks.length;
  const numbers = new Map<string, Float64Array>();
  for (const f of NUMERIC_FIELD_LIST) {
    const col = new Float64Array(size);
    const key = f.key as keyof Stock;
    for (let i = 0; i < size; i++) {
      const v = stocks[i]![key];
      col[i] = typeof v === 'number' ? v : NaN;
    }
    numbers.set(f.key, col);
  }
  for (const [key, def] of Object.entries(BOOLEAN_FIELDS)) {
    const col = new Float64Array(size);
    for (let i = 0; i < size; i++) col[i] = def.test(stocks[i]!) ? 1 : 0;
    numbers.set(key, col);
  }

  const categories = new Map<string, CategoryColumn>();
  for (const f of CATEGORY_FIELD_LIST) {
    const dictionary = [...(ENUM_VALUES[f.key] ?? [])];
    const lookup = new Map(dictionary.map((v, i) => [v, i]));
    const codes = new Uint16Array(size);
    const key = f.key as keyof Stock;
    for (let i = 0; i < size; i++) {
      const v = String(stocks[i]![key] ?? '');
      let c = lookup.get(v);
      if (c === undefined) {
        c = dictionary.length;
        dictionary.push(v);
        lookup.set(v, c);
      }
      codes[i] = c;
    }
    categories.set(f.key, { codes, dictionary, lookup });
  }

  const masks = new Uint32Array(size);
  for (let i = 0; i < size; i++) masks[i] = indexMembershipMask(stocks[i]!.indices);

  return {
    size,
    version,
    liveVersion: 0,
    symbols: stocks.map(s => s.symbol),
    names: stocks.map(s => s.name),
    numbers,
    categories,
    sets: new Map([['indices', masks]]),
    search: stocks.map(s => `${s.symbol} ${s.name} ${s.sector} ${s.industry}`.toLowerCase()),
  };
}

const LIVE_NUMERIC = NUMERIC_FIELD_LIST.filter(f => f.live).map(f => f.key as keyof Stock);

/**
 * Writes live-derived values for the given rows into the columns and bumps
 * `liveVersion`, which invalidates cached results for live fields only.
 */
export function writeLiveRows(store: ColumnStore, rows: Iterable<Stock>): number {
  let written = 0;
  const zones = store.categories.get('bbZone');
  for (const s of rows) {
    const i = s.id;
    if (i < 0 || i >= store.size) continue;
    for (const key of LIVE_NUMERIC) {
      const v = s[key];
      store.numbers.get(key)![i] = typeof v === 'number' ? v : NaN;
    }
    if (zones) {
      const c = zones.lookup.get(s.bbZone);
      if (c !== undefined) zones.codes[i] = c;
    }
    written++;
  }
  if (written) store.liveVersion++;
  return written;
}
