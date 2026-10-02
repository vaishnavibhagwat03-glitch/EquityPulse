/**
 * Filter engine.
 *
 * Evaluates a filter expression tree (nested AND / OR / NOT groups of
 * conditions) over the columnar universe and returns matching row positions,
 * sorted. Framework-free and deterministic: the React layer, the API, the
 * tests and the benchmark all call the same code.
 *
 * Design:
 * - Each condition compiles to one tight loop over a typed array and produces
 *   a Bitset (one bit per stock).
 * - Condition results are memoised by a signature of (field, operator, value)
 *   plus the data version. Adjusting one slider recomputes one condition; the
 *   others are cache hits. Live price refreshes invalidate only conditions on
 *   live fields.
 * - Groups combine child bitsets with word-wise AND/OR/NOT (~164 operations for
 *   5,247 rows), so arbitrarily nested expressions cost almost nothing extra.
 * - Nulls never satisfy a comparison (a loss-maker has no P/E, so "P/E < 15"
 *   excludes it). Use `isNull` / `isNotNull` to target them explicitly.
 */
import type { Stock } from '@/types/market';
import type { Condition, FilterNode, Group, ScreenStats } from '@/types/filters';
import { Bitset } from './filters/bitset';
import { buildColumnStore, type ColumnStore } from './filters/columnStore';
import { FIELD_META, fieldKind, isLiveField } from './filters/fields';
import { Sorter, type SortSpec } from './filters/sort';
import { INDEX_MEMBERSHIP_LABELS } from './market/indices';

export interface EvalContext {
  watchlist?: ReadonlySet<string>;
  /** Changes whenever the watchlist changes; part of the cache key. */
  watchlistVersion?: number;
}

export interface ScreenResult {
  /** Matching row positions (stock ids), in display order. */
  indices: Uint32Array;
  stats: ScreenStats;
  issues: string[];
}

export class FilterError extends Error {
  constructor(
    message: string,
    readonly conditionId?: string,
  ) {
    super(message);
    this.name = 'FilterError';
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

const NUMERIC_OPS = new Set([
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'between',
  'notBetween',
  'above',
  'below',
  'isNull',
  'isNotNull',
]);
const CATEGORY_OPS = new Set(['in', 'notIn', 'isNull', 'isNotNull']);
const SET_OPS = new Set(['hasAny', 'hasAll', 'hasNone']);
const BOOLEAN_OPS = new Set(['isTrue', 'isFalse']);

/** Returns a human-readable problem with the condition, or null if valid. */
export function validateCondition(c: Condition): string | null {
  const kind = fieldKind(c.field);
  if (!kind) return `Unknown field "${c.field}"`;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  switch (kind) {
    case 'number':
      if (!NUMERIC_OPS.has(c.op)) return `Operator "${c.op}" does not apply to ${c.field}`;
      if (c.op === 'between' || c.op === 'notBetween') {
        if (!Array.isArray(c.value) || c.value.length !== 2 || !c.value.every(isNum)) {
          return `${c.op} needs a [min, max] pair`;
        }
      } else if (c.op === 'above' || c.op === 'below') {
        if (!c.compareTo || fieldKind(c.compareTo) !== 'number')
          return `${c.op} needs a numeric compareTo field`;
        if (c.multiplier !== undefined && !isNum(c.multiplier))
          return 'multiplier must be a number';
      } else if (c.op !== 'isNull' && c.op !== 'isNotNull' && !isNum(c.value)) {
        return `${c.op} needs a numeric value`;
      }
      return null;
    case 'category':
      if (!CATEGORY_OPS.has(c.op)) return `Operator "${c.op}" does not apply to ${c.field}`;
      if (
        (c.op === 'in' || c.op === 'notIn') &&
        (!Array.isArray(c.value) || !c.value.every(v => typeof v === 'string'))
      ) {
        return `${c.op} needs a list of values`;
      }
      return null;
    case 'set':
      if (!SET_OPS.has(c.op)) return `Operator "${c.op}" does not apply to ${c.field}`;
      if (!Array.isArray(c.value) || !c.value.every(v => typeof v === 'string'))
        return `${c.op} needs a list of values`;
      return null;
    case 'boolean':
    case 'context':
      return BOOLEAN_OPS.has(c.op) ? null : `Operator "${c.op}" does not apply to ${c.field}`;
    case 'text':
      return c.op === 'contains' && typeof c.value === 'string'
        ? null
        : 'search needs a text value';
  }
}

/** Collects problems anywhere in the tree. */
export function validateExpression(node: FilterNode, path = 'root'): string[] {
  if (node.kind === 'condition') {
    const issue = validateCondition(node);
    return issue ? [`${path}: ${issue}`] : [];
  }
  if (node.combinator !== 'AND' && node.combinator !== 'OR') return [`${path}: invalid combinator`];
  return node.children.flatMap((child, i) => validateExpression(child, `${path}.${i}`));
}

/* ------------------------------------------------------------------------ */
/* Condition evaluation                                                     */
/* ------------------------------------------------------------------------ */

function fromPredicate(size: number, test: (i: number) => boolean): Bitset {
  const out = Bitset.empty(size);
  const w = out.words;
  let word = 0;
  for (let i = 0; i < size; i++) {
    if (test(i)) word |= 1 << (i & 31);
    if ((i & 31) === 31) {
      w[i >>> 5] = word >>> 0;
      word = 0;
    }
  }
  if (size & 31) w[size >>> 5] = word >>> 0;
  return out;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

export function computeCondition(c: Condition, store: ColumnStore, ctx: EvalContext): Bitset {
  const issue = validateCondition(c);
  if (issue) throw new FilterError(issue, c.id);
  const n = store.size;

  switch (fieldKind(c.field)) {
    case 'number':
    case 'boolean': {
      const col = store.numbers.get(c.field);
      if (!col) throw new FilterError(`No column for ${c.field}`, c.id);
      const v = c.value as number;
      switch (c.op) {
        case 'gt':
          return fromPredicate(n, i => col[i]! > v);
        case 'gte':
          return fromPredicate(n, i => col[i]! >= v);
        case 'lt':
          return fromPredicate(n, i => col[i]! < v);
        case 'lte':
          return fromPredicate(n, i => col[i]! <= v);
        case 'eq':
          return fromPredicate(n, i => approxEqual(col[i]!, v));
        case 'neq':
          return fromPredicate(n, i => col[i] === col[i] && !approxEqual(col[i]!, v));
        case 'between':
        case 'notBetween': {
          const [a, b] = c.value as [number, number];
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return c.op === 'between'
            ? fromPredicate(n, i => col[i]! >= lo && col[i]! <= hi)
            : fromPredicate(n, i => col[i]! < lo || col[i]! > hi);
        }
        case 'above':
        case 'below': {
          const other = store.numbers.get(c.compareTo!);
          if (!other) throw new FilterError(`No column for ${c.compareTo}`, c.id);
          const m = c.multiplier ?? 1;
          return c.op === 'above'
            ? fromPredicate(n, i => col[i]! > other[i]! * m)
            : fromPredicate(n, i => col[i]! < other[i]! * m);
        }
        case 'isNull':
          return fromPredicate(n, i => col[i] !== col[i]);
        case 'isNotNull':
          return fromPredicate(n, i => col[i] === col[i]);
        case 'isTrue':
          return fromPredicate(n, i => col[i] === 1);
        case 'isFalse':
          return fromPredicate(n, i => col[i] === 0);
        default:
          throw new FilterError(`Unsupported operator ${c.op}`, c.id);
      }
    }
    case 'category': {
      const cat = store.categories.get(c.field);
      if (!cat) throw new FilterError(`No column for ${c.field}`, c.id);
      const codes = cat.codes;
      if (c.op === 'isNull') return fromPredicate(n, i => cat.dictionary[codes[i]!] === '');
      if (c.op === 'isNotNull') return fromPredicate(n, i => cat.dictionary[codes[i]!] !== '');
      const allowed = new Uint8Array(cat.dictionary.length);
      for (const value of c.value as string[]) {
        const code = cat.lookup.get(value);
        if (code !== undefined) allowed[code] = 1;
      }
      return c.op === 'in'
        ? fromPredicate(n, i => allowed[codes[i]!] === 1)
        : fromPredicate(n, i => allowed[codes[i]!] === 0);
    }
    case 'set': {
      const masks = store.sets.get(c.field);
      if (!masks) throw new FilterError(`No column for ${c.field}`, c.id);
      let selected = 0;
      for (const label of c.value as string[]) {
        const bit = INDEX_MEMBERSHIP_LABELS.indexOf(label);
        if (bit >= 0) selected |= 1 << bit;
      }
      if (c.op === 'hasAny') return fromPredicate(n, i => (masks[i]! & selected) !== 0);
      if (c.op === 'hasAll') return fromPredicate(n, i => (masks[i]! & selected) === selected);
      return fromPredicate(n, i => (masks[i]! & selected) === 0);
    }
    case 'text': {
      const tokens = String(c.value).toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return Bitset.full(n);
      const hay = store.search;
      return fromPredicate(n, i => tokens.every(t => hay[i]!.includes(t)));
    }
    case 'context': {
      const set = ctx.watchlist ?? new Set<string>();
      const symbols = store.symbols;
      return c.op === 'isTrue'
        ? fromPredicate(n, i => set.has(symbols[i]!))
        : fromPredicate(n, i => !set.has(symbols[i]!));
    }
    default:
      throw new FilterError(`Unknown field "${c.field}"`, c.id);
  }
}

/** Cache key: what the condition asks, plus every version it depends on. */
export function conditionKey(c: Condition, store: ColumnStore, ctx: EvalContext): string {
  const value = Array.isArray(c.value) ? c.value.join('\u0001') : String(c.value ?? '');
  let key = `${store.version}|${c.field}|${c.op}|${value}|${c.compareTo ?? ''}|${c.multiplier ?? ''}`;
  if (isLiveField(c.field) || isLiveField(c.compareTo)) key += `|L${store.liveVersion}`;
  if (fieldKind(c.field) === 'context') key += `|W${ctx.watchlistVersion ?? 0}`;
  return key;
}

/* ------------------------------------------------------------------------ */
/* Engine                                                                   */
/* ------------------------------------------------------------------------ */

const CACHE_LIMIT = 512;

interface NodeResult {
  bits: Bitset;
  /** True when `bits` is a fresh copy the caller may mutate. */
  owned: boolean;
}

export class FilterEngine {
  private store: ColumnStore;
  private readonly cache = new Map<string, Bitset>();
  private readonly sorter = new Sorter();
  private hits = 0;
  private misses = 0;
  private conditions = 0;
  private issues: string[] = [];

  constructor(store: ColumnStore) {
    this.store = store;
  }

  get columns(): ColumnStore {
    return this.store;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** Swaps in a new dataset; every cached result is dropped. */
  setStore(store: ColumnStore): void {
    if (store === this.store) return;
    this.store = store;
    this.cache.clear();
    this.sorter.clear();
  }

  clearCache(): void {
    this.cache.clear();
    this.sorter.clear();
  }

  private condition(c: Condition, ctx: EvalContext): Bitset {
    const key = conditionKey(c, this.store, ctx);
    const cached = this.cache.get(key);
    if (cached) {
      this.hits++;
      // Refresh recency for the LRU.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    this.misses++;
    const bits = computeCondition(c, this.store, ctx);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, bits);
    return bits;
  }

  /** `null` means "no constraint" (empty group or only disabled/invalid conditions). */
  private node(node: FilterNode, ctx: EvalContext): NodeResult | null {
    if (node.kind === 'condition') {
      if (node.disabled) return null;
      const issue = validateCondition(node);
      if (issue) {
        this.issues.push(issue);
        return null;
      }
      this.conditions++;
      return { bits: this.condition(node, ctx), owned: false };
    }
    return this.group(node, ctx);
  }

  private group(g: Group, ctx: EvalContext): NodeResult | null {
    let acc: Bitset | null = null;
    for (const child of g.children) {
      const r = this.node(child, ctx);
      if (!r) continue;
      if (!acc) acc = r.owned ? r.bits : r.bits.clone();
      else if (g.combinator === 'AND') acc.and(r.bits);
      else acc.or(r.bits);
      // Nothing can survive an AND once it is empty.
      if (g.combinator === 'AND' && acc.isEmpty()) break;
    }
    if (!acc) return null;
    if (g.negate) acc.not();
    return { bits: acc, owned: true };
  }

  evaluate(node: FilterNode | null, ctx: EvalContext = {}): Bitset {
    if (!node) return Bitset.full(this.store.size);
    const r = this.node(node, ctx);
    if (!r) return Bitset.full(this.store.size);
    return r.owned ? r.bits : r.bits.clone();
  }

  screen(
    node: FilterNode | null,
    options: { ctx?: EvalContext; sort?: SortSpec | null } = {},
  ): ScreenResult {
    const ctx = options.ctx ?? {};
    this.hits = 0;
    this.misses = 0;
    this.conditions = 0;
    this.issues = [];

    const t0 = now();
    const bits = this.evaluate(node, ctx);
    const t1 = now();
    const indices = options.sort
      ? this.sorter.subset(this.store, bits, options.sort)
      : bits.toIndices();
    const t2 = now();

    return {
      indices,
      issues: this.issues,
      stats: {
        total: this.store.size,
        matched: indices.length,
        conditionCount: this.conditions,
        cacheHits: this.hits,
        cacheMisses: this.misses,
        timings: {
          compileMs: 0,
          evaluateMs: t1 - t0,
          sortMs: t2 - t1,
          totalMs: t2 - t0,
        },
      },
    };
  }
}

/** One-shot convenience: build columns, evaluate, sort. */
export function runScreen(
  stocks: readonly Stock[],
  node: FilterNode | null,
  options: { ctx?: EvalContext; sort?: SortSpec | null; version?: string } = {},
): { stocks: Stock[]; result: ScreenResult } {
  const engine = new FilterEngine(buildColumnStore(stocks, options.version ?? 'adhoc'));
  const result = engine.screen(node, options);
  return { stocks: Array.from(result.indices, i => stocks[i]!), result };
}

/** Builds an AND group from conditions — handy for presets and tests. */
export function and(...children: FilterNode[]): Group {
  return { kind: 'group', id: `and-${children.length}`, combinator: 'AND', children };
}

export function or(...children: FilterNode[]): Group {
  return { kind: 'group', id: `or-${children.length}`, combinator: 'OR', children };
}

export function not(child: FilterNode): Group {
  return { kind: 'group', id: 'not', combinator: 'AND', negate: true, children: [child] };
}

let conditionSeq = 0;
export function cond(
  field: string,
  op: Condition['op'],
  value?: Condition['value'],
  extra: Partial<Pick<Condition, 'compareTo' | 'multiplier' | 'id'>> = {},
): Condition {
  return { kind: 'condition', id: extra.id ?? `c${++conditionSeq}`, field, op, value, ...extra };
}

export { FIELD_META };
