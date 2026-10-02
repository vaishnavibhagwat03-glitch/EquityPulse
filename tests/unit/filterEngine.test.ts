import { describe, expect, it } from 'vitest';
import type { Stock } from '@/types/market';
import type { Condition, FilterNode, Group } from '@/types/filters';
import {
  and,
  computeCondition,
  cond,
  conditionKey,
  FilterEngine,
  FilterError,
  not,
  or,
  runScreen,
  validateCondition,
  validateExpression,
} from '@/lib/filterEngine';
import { buildColumnStore, writeLiveRows } from '@/lib/filters/columnStore';
import { BOOLEAN_FIELDS, NUMERIC_FIELD_LIST } from '@/lib/filters/fields';
import { panelToExpression } from '@/lib/filters/panel';
import { BUILT_IN_PRESETS, panelFromPreset } from '@/lib/filters/presets';
import { createRng } from '@/lib/random';
import { fullMarket, makeStocks } from '../fixtures/market';

/*
 * A six-row universe where every expected answer can be checked by eye.
 *
 *   #  symbol  P/E    ROE    D/E   Yield  sector                  exch  price  SMA50  SMA200  RSI  vol / avg
 *   0  VALUEA  10     20     0.2   3      Banking                 NSE   100    90     80      55   1000 / 400
 *   1  GROWB   25     12     1.2   0.5    Information Technology  BSE   50     60     55      35   300 / 300
 *   2  LOSSC   null   -5     null  0      Pharmaceuticals         NSE   20     22     25      28   50 / 100
 *   3  EDGED   15     15     0.5   2      Banking                 NSE   200    200    150     70   900 / 450
 *   4  JUSTE   14.99  15.01  0.49  2.01   Information Technology  NSE   300    280    260     40   2000 / 900
 *   5  RICHF   40     30     0     1      Automobile              BSE   500    520    480     65   100 / 100
 */
const STOCKS = makeStocks([
  {
    symbol: 'VALUEA',
    name: 'Alpha Finance Ltd',
    pe: 10,
    roe: 20,
    debtToEquity: 0.2,
    dividendYield: 3,
    sector: 'Banking',
    industry: 'Private Bank',
    exchange: 'NSE',
    marketCapCategory: 'Large Cap',
    indices: ['NIFTY 50', 'SENSEX'],
    price: 100,
    sma50: 90,
    sma200: 80,
    rsi14: 55,
    volume: 1000,
    avgVolume: 400,
    eps: 10,
    dividendPerShare: 3,
  },
  {
    symbol: 'GROWB',
    name: 'Beta Software Ltd',
    pe: 25,
    roe: 12,
    debtToEquity: 1.2,
    dividendYield: 0.5,
    sector: 'Information Technology',
    industry: 'IT Services',
    exchange: 'BSE',
    marketCapCategory: 'Mid Cap',
    indices: ['NIFTY 500'],
    price: 50,
    sma50: 60,
    sma200: 55,
    rsi14: 35,
    volume: 300,
    avgVolume: 300,
    eps: 2,
    dividendPerShare: 0.25,
  },
  {
    symbol: 'LOSSC',
    name: 'Gamma Pharma Ltd',
    pe: null,
    roe: -5,
    debtToEquity: null,
    dividendYield: 0,
    sector: 'Pharmaceuticals',
    industry: 'Formulations',
    exchange: 'NSE',
    marketCapCategory: 'Small Cap',
    indices: [],
    price: 20,
    sma50: 22,
    sma200: 25,
    rsi14: 28,
    volume: 50,
    avgVolume: 100,
    eps: -2,
    dividendPerShare: 0,
  },
  {
    symbol: 'EDGED',
    name: 'Delta Bank Ltd',
    pe: 15,
    roe: 15,
    debtToEquity: 0.5,
    dividendYield: 2,
    sector: 'Banking',
    industry: 'Private Bank',
    exchange: 'NSE',
    marketCapCategory: 'Large Cap',
    indices: ['NIFTY 50'],
    price: 200,
    sma50: 200,
    sma200: 150,
    rsi14: 70,
    volume: 900,
    avgVolume: 450,
    eps: 13.33,
    dividendPerShare: 4,
  },
  {
    symbol: 'JUSTE',
    name: 'Epsilon Systems Ltd',
    pe: 14.99,
    roe: 15.01,
    debtToEquity: 0.49,
    dividendYield: 2.01,
    sector: 'Information Technology',
    industry: 'IT Services',
    exchange: 'NSE',
    marketCapCategory: 'Large Cap',
    indices: ['NIFTY 50', 'NIFTY IT'],
    price: 300,
    sma50: 280,
    sma200: 260,
    rsi14: 40,
    volume: 2000,
    avgVolume: 900,
    eps: 20,
    dividendPerShare: 6.03,
  },
  {
    symbol: 'RICHF',
    name: 'Zeta Motors Ltd',
    pe: 40,
    roe: 30,
    debtToEquity: 0,
    dividendYield: 1,
    sector: 'Automobile',
    industry: 'Passenger Vehicles',
    exchange: 'BSE',
    marketCapCategory: 'Mid Cap',
    indices: ['NIFTY 500'],
    price: 500,
    sma50: 520,
    sma200: 480,
    rsi14: 65,
    volume: 100,
    avgVolume: 100,
    eps: 12.5,
    dividendPerShare: 5,
  },
]);

const ALL = [0, 1, 2, 3, 4, 5];

function rows(node: FilterNode | null, ctx = {}): number[] {
  const engine = new FilterEngine(buildColumnStore(STOCKS, 'fixture'));
  return Array.from(engine.screen(node, { ctx }).indices);
}

/* ------------------------------------------------------------------------ */
/* A reference interpreter: row by row over Stock objects, no columns, no    */
/* bitsets, no cache. The engine must agree with it on every expression.     */
/* ------------------------------------------------------------------------ */

function naiveCondition(c: Condition, s: Stock, watchlist: ReadonlySet<string>): boolean {
  if (c.field === 'watchlist')
    return c.op === 'isTrue' ? watchlist.has(s.symbol) : !watchlist.has(s.symbol);
  if (c.field === 'search') {
    const hay = `${s.symbol} ${s.name} ${s.sector} ${s.industry}`.toLowerCase();
    return String(c.value)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every(t => hay.includes(t));
  }
  if (c.field === 'indices') {
    const wanted = c.value as string[];
    if (c.op === 'hasAny') return wanted.some(v => s.indices.includes(v));
    if (c.op === 'hasAll') return wanted.every(v => s.indices.includes(v));
    return wanted.every(v => !s.indices.includes(v));
  }
  if (c.field in BOOLEAN_FIELDS) {
    const flag = BOOLEAN_FIELDS[c.field]!.test(s);
    return c.op === 'isTrue' ? flag : !flag;
  }
  const raw = (s as unknown as Record<string, unknown>)[c.field];
  if (typeof raw === 'string') {
    if (c.op === 'in') return (c.value as string[]).includes(raw);
    if (c.op === 'notIn') return !(c.value as string[]).includes(raw);
    throw new Error(`naive: unsupported ${c.op} on ${c.field}`);
  }
  const x = typeof raw === 'number' ? raw : null;
  if (c.op === 'isNull') return x === null;
  if (c.op === 'isNotNull') return x !== null;
  if (x === null) return false;
  switch (c.op) {
    case 'gt':
      return x > (c.value as number);
    case 'gte':
      return x >= (c.value as number);
    case 'lt':
      return x < (c.value as number);
    case 'lte':
      return x <= (c.value as number);
    case 'eq':
      return Math.abs(x - (c.value as number)) <= 1e-9 * Math.max(1, Math.abs(c.value as number));
    case 'neq':
      return Math.abs(x - (c.value as number)) > 1e-9 * Math.max(1, Math.abs(c.value as number));
    case 'between':
    case 'notBetween': {
      const [a, b] = c.value as [number, number];
      const inside = x >= Math.min(a, b) && x <= Math.max(a, b);
      return c.op === 'between' ? inside : !inside;
    }
    case 'above':
    case 'below': {
      const other = (s as unknown as Record<string, number | null>)[c.compareTo!];
      if (other === null || other === undefined) return false;
      const target = other * (c.multiplier ?? 1);
      return c.op === 'above' ? x > target : x < target;
    }
    default:
      throw new Error(`naive: unsupported ${c.op}`);
  }
}

function naive(
  node: FilterNode,
  s: Stock,
  watchlist: ReadonlySet<string> = new Set(),
): boolean | null {
  if (node.kind === 'condition') return node.disabled ? null : naiveCondition(node, s, watchlist);
  const results = node.children
    .map(child => naive(child, s, watchlist))
    .filter((r): r is boolean => r !== null);
  if (!results.length) return null;
  const combined = node.combinator === 'AND' ? results.every(Boolean) : results.some(Boolean);
  return node.negate ? !combined : combined;
}

const naiveRows = (stocks: readonly Stock[], node: FilterNode | null): number[] =>
  stocks.flatMap((s, i) => (node === null || naive(node, s) !== false ? [i] : []));

/* ------------------------------------------------------------------------ */

describe('filter engine — conditions', () => {
  it('honours strict and inclusive bounds exactly at the boundary', () => {
    expect(rows(cond('pe', 'lt', 15))).toEqual([0, 4]);
    expect(rows(cond('pe', 'lte', 15))).toEqual([0, 3, 4]);
    expect(rows(cond('roe', 'gt', 15))).toEqual([0, 4, 5]);
    expect(rows(cond('roe', 'gte', 15))).toEqual([0, 3, 4, 5]);
  });

  it('matches eq with float tolerance; neq never matches a null', () => {
    expect(rows(cond('pe', 'eq', 15))).toEqual([3]);
    expect(rows(cond('eps', 'eq', 13.33))).toEqual([3]);
    expect(rows(cond('pe', 'neq', 15))).toEqual([0, 1, 4, 5]);
  });

  it('treats between as inclusive and order-agnostic; notBetween excludes nulls', () => {
    expect(rows(cond('rsi14', 'between', [40, 65]))).toEqual([0, 4, 5]);
    expect(rows(cond('rsi14', 'between', [65, 40]))).toEqual([0, 4, 5]);
    expect(rows(cond('pe', 'notBetween', [10, 20]))).toEqual([1, 5]);
  });

  it('never lets a null satisfy a comparison, and targets nulls explicitly', () => {
    // A loss-maker has no P/E: "P/E < 1000" must not include it.
    expect(rows(cond('pe', 'lt', 1000))).toEqual([0, 1, 3, 4, 5]);
    expect(rows(cond('pe', 'isNull'))).toEqual([2]);
    expect(rows(cond('pe', 'isNotNull'))).toEqual([0, 1, 3, 4, 5]);
    expect(rows(cond('debtToEquity', 'isNull'))).toEqual([2]);
  });

  it('compares one field against another, with a multiplier', () => {
    expect(rows(cond('price', 'above', undefined, { compareTo: 'sma50' }))).toEqual([0, 4]);
    expect(rows(cond('price', 'below', undefined, { compareTo: 'sma200' }))).toEqual([1, 2]);
    // "Volume above 2× average" — 900 vs 2 × 450 is not strictly above.
    expect(
      rows(cond('volume', 'above', undefined, { compareTo: 'avgVolume', multiplier: 2 })),
    ).toEqual([0, 4]);
  });

  it('filters categories with in / notIn and ignores unknown values', () => {
    expect(rows(cond('sector', 'in', ['Banking']))).toEqual([0, 3]);
    expect(rows(cond('sector', 'notIn', ['Banking', 'No Such Sector']))).toEqual([1, 2, 4, 5]);
    expect(rows(cond('exchange', 'in', ['BSE']))).toEqual([1, 5]);
    expect(rows(cond('marketCapCategory', 'in', ['Large Cap', 'Mid Cap']))).toEqual([
      0, 1, 3, 4, 5,
    ]);
  });

  it('tests index membership with hasAny / hasAll / hasNone', () => {
    expect(rows(cond('indices', 'hasAny', ['NIFTY 50']))).toEqual([0, 3, 4]);
    expect(rows(cond('indices', 'hasAll', ['NIFTY 50', 'SENSEX']))).toEqual([0]);
    expect(rows(cond('indices', 'hasNone', ['NIFTY 50', 'NIFTY 500']))).toEqual([2]);
  });

  it('evaluates derived boolean flags', () => {
    expect(rows(cond('isProfitable', 'isTrue'))).toEqual([0, 1, 3, 4, 5]);
    expect(rows(cond('isProfitable', 'isFalse'))).toEqual([2]);
    expect(rows(cond('debtFree', 'isTrue'))).toEqual([5]);
    expect(rows(cond('paysDividend', 'isFalse'))).toEqual([2]);
  });

  it('searches symbol, name, sector and industry; every token must match', () => {
    expect(rows(cond('search', 'contains', 'bank'))).toEqual([0, 3]);
    expect(rows(cond('search', 'contains', 'BANK delta'))).toEqual([3]);
    expect(rows(cond('search', 'contains', 'richf'))).toEqual([5]);
    expect(rows(cond('search', 'contains', '   '))).toEqual(ALL);
  });

  it('screens the watchlist from the evaluation context', () => {
    const watchlist = new Set(['GROWB', 'RICHF']);
    expect(rows(cond('watchlist', 'isTrue'), { watchlist })).toEqual([1, 5]);
    expect(rows(cond('watchlist', 'isFalse'), { watchlist })).toEqual([0, 2, 3, 4]);
    expect(rows(cond('watchlist', 'isTrue'))).toEqual([]);
  });
});

describe('filter engine — combinatorial logic', () => {
  it('narrows with AND and widens with OR', () => {
    expect(rows(and(cond('pe', 'lt', 15), cond('roe', 'gt', 15)))).toEqual([0, 4]);
    expect(rows(or(cond('sector', 'in', ['Banking']), cond('exchange', 'in', ['BSE'])))).toEqual([
      0, 1, 3, 5,
    ]);
  });

  it('negates a group (the complement includes rows with nulls)', () => {
    expect(rows(not(cond('sector', 'in', ['Banking'])))).toEqual([1, 2, 4, 5]);
    expect(rows(not(cond('pe', 'gt', 20)))).toEqual([0, 2, 3, 4]);
  });

  it('evaluates nested groups', () => {
    const banksOrTech = or(
      cond('sector', 'in', ['Banking']),
      cond('sector', 'in', ['Information Technology']),
    );
    expect(rows(and(banksOrTech, not(cond('pe', 'gt', 20))))).toEqual([0, 3, 4]);
    const deep = and(
      or(and(cond('roe', 'gt', 10), cond('pe', 'lt', 30)), cond('exchange', 'in', ['BSE'])),
      cond('rsi14', 'gte', 40),
    );
    expect(rows(deep)).toEqual(naiveRows(STOCKS, deep));
  });

  it('treats empty groups and disabled conditions as no constraint', () => {
    expect(rows(null)).toEqual(ALL);
    expect(rows(and())).toEqual(ALL);
    expect(rows(and({ ...cond('pe', 'lt', 1), disabled: true }))).toEqual(ALL);
    expect(rows(and(cond('pe', 'lt', 15), { ...cond('roe', 'gt', 100), disabled: true }))).toEqual([
      0, 4,
    ]);
    expect(rows(or(cond('pe', 'lt', 15), and()))).toEqual([0, 4]);
  });

  it('stops evaluating an AND as soon as it is empty', () => {
    const engine = new FilterEngine(buildColumnStore(STOCKS, 'fixture'));
    const r = engine.screen(
      and(cond('pe', 'gt', 1000), cond('roe', 'gt', 0), cond('rsi14', 'gt', 0)),
    );
    expect(r.indices.length).toBe(0);
    expect(r.stats.conditionCount).toBe(1);
  });
});

describe('filter engine — validation', () => {
  it('explains invalid conditions', () => {
    expect(validateCondition(cond('nope', 'gt', 1))).toMatch(/Unknown field/);
    expect(validateCondition(cond('pe', 'in', ['x']))).toMatch(/does not apply/);
    expect(validateCondition(cond('pe', 'gt'))).toMatch(/numeric value/);
    expect(validateCondition(cond('pe', 'between', [1] as unknown as [number, number]))).toMatch(
      /\[min, max\]/,
    );
    expect(validateCondition(cond('price', 'above', undefined, { compareTo: 'sector' }))).toMatch(
      /compareTo/,
    );
    expect(validateCondition(cond('sector', 'in', 'Banking'))).toMatch(/list of values/);
    expect(validateCondition(cond('indices', 'hasAny', 3))).toMatch(/list of values/);
    expect(validateCondition(cond('isProfitable', 'gt', 1))).toMatch(/does not apply/);
    expect(validateCondition(cond('search', 'contains', 3))).toMatch(/text value/);
    expect(validateCondition(cond('pe', 'lt', 15))).toBeNull();
  });

  it('reports problems with their position in the tree', () => {
    const issues = validateExpression(
      and(cond('pe', 'lt', 15), or(cond('roe', 'gt', 1), cond('nope', 'gt', 1))),
    );
    expect(issues).toEqual(['root.1.1: Unknown field "nope"']);
    expect(
      validateExpression({ kind: 'group', id: 'g', combinator: 'XOR' as 'AND', children: [] }),
    ).toEqual(['root: invalid combinator']);
  });

  it('skips invalid conditions while screening and reports them', () => {
    const engine = new FilterEngine(buildColumnStore(STOCKS, 'fixture'));
    const r = engine.screen(and(cond('pe', 'lt'), cond('nope', 'gt', 1), cond('pe', 'lt', 15)));
    expect(Array.from(r.indices)).toEqual([0, 4]);
    expect(r.issues).toHaveLength(2);
  });

  it('throws a FilterError carrying the condition id when evaluated directly', () => {
    const store = buildColumnStore(STOCKS, 'fixture');
    const bad = cond('pe', 'contains', 'x', { id: 'bad-1' });
    expect(() => computeCondition(bad, store, {})).toThrow(FilterError);
    try {
      computeCondition(bad, store, {});
    } catch (e) {
      expect((e as FilterError).conditionId).toBe('bad-1');
    }
  });
});

describe('filter engine — sorting, caching and live data', () => {
  it('sorts with nulls last in both directions and stable ties', () => {
    const engine = new FilterEngine(buildColumnStore(STOCKS, 'fixture'));
    expect(
      Array.from(engine.screen(null, { sort: { field: 'pe', direction: 'asc' } }).indices),
    ).toEqual([0, 4, 3, 1, 5, 2]);
    expect(
      Array.from(engine.screen(null, { sort: { field: 'pe', direction: 'desc' } }).indices),
    ).toEqual([5, 1, 3, 4, 0, 2]);
    expect(
      Array.from(engine.screen(null, { sort: { field: 'symbol', direction: 'asc' } }).indices),
    ).toEqual([3, 1, 4, 2, 5, 0]);
    expect(
      Array.from(engine.screen(null, { sort: { field: 'sector', direction: 'asc' } }).indices),
    ).toEqual([5, 0, 3, 1, 4, 2]);
    // Filtered + sorted is the sorted order restricted to matches.
    const r = engine.screen(cond('exchange', 'in', ['NSE']), {
      sort: { field: 'price', direction: 'desc' },
    });
    expect(Array.from(r.indices)).toEqual([4, 3, 0, 2]);
  });

  it('caches condition results and reuses them across screens', () => {
    const engine = new FilterEngine(buildColumnStore(STOCKS, 'fixture'));
    const expr = and(cond('pe', 'lt', 15), cond('roe', 'gt', 15));
    const first = engine.screen(expr);
    expect(first.stats.cacheMisses).toBe(2);
    const second = engine.screen(and(cond('roe', 'gt', 15), cond('pe', 'lt', 15)));
    expect(second.stats.cacheHits).toBe(2);
    expect(second.stats.cacheMisses).toBe(0);
    expect(Array.from(second.indices)).toEqual(Array.from(first.indices));
    expect(engine.cacheSize).toBe(2);
    engine.setStore(buildColumnStore(STOCKS, 'fixture-2'));
    expect(engine.cacheSize).toBe(0);
  });

  it('re-evaluates only live conditions after live values change', () => {
    const store = buildColumnStore(STOCKS, 'fixture');
    const engine = new FilterEngine(store);
    const expr = and(cond('price', 'gt', 150), cond('roe', 'gt', 15));
    expect(Array.from(engine.screen(expr).indices)).toEqual([4, 5]);

    expect(writeLiveRows(store, [{ ...STOCKS[4]!, price: 100 }])).toBe(1);
    const after = engine.screen(expr);
    expect(Array.from(after.indices)).toEqual([5]);
    expect(after.stats.cacheHits).toBe(1); // ROE is not live: still cached
    expect(after.stats.cacheMisses).toBe(1); // price is live: recomputed
  });

  it('keys the cache on the data, live and watchlist versions it depends on', () => {
    const store = buildColumnStore(STOCKS, 'v1');
    const price = cond('price', 'gt', 1);
    const roe = cond('roe', 'gt', 1);
    const watch = cond('watchlist', 'isTrue');
    const before = [
      conditionKey(price, store, {}),
      conditionKey(roe, store, {}),
      conditionKey(watch, store, { watchlistVersion: 1 }),
    ];
    store.liveVersion++;
    expect(conditionKey(price, store, {})).not.toBe(before[0]);
    expect(conditionKey(roe, store, {})).toBe(before[1]);
    expect(conditionKey(watch, store, { watchlistVersion: 2 })).not.toBe(before[2]);
  });

  it('is deterministic: the same screen always returns the same rows', () => {
    const expr = or(and(cond('roe', 'gt', 12), cond('pe', 'lt', 30)), cond('debtFree', 'isTrue'));
    expect(rows(expr)).toEqual(rows(expr));
    const { stocks } = runScreen(STOCKS, expr, { sort: { field: 'roe', direction: 'desc' } });
    expect(stocks.map(s => s.symbol)).toEqual(['RICHF', 'VALUEA', 'JUSTE', 'EDGED']);
  });
});

describe('filter engine — full universe', () => {
  const model = fullMarket();
  const engine = new FilterEngine(buildColumnStore(model.stocks, model.meta.version));

  it('runs every built-in preset exactly as a row-by-row reference would', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const expr = panelToExpression(panelFromPreset(preset));
      expect(expr, preset.name).not.toBeNull();
      const got = Array.from(engine.screen(expr).indices);
      expect(got, preset.name).toEqual(naiveRows(model.stocks, expr));
    }
  });

  it('applies the Value Stocks criteria from the specification', () => {
    const preset = BUILT_IN_PRESETS.find(p => p.id === 'value')!;
    const got = Array.from(engine.screen(panelToExpression(panelFromPreset(preset))).indices);
    const expected = model.stocks.flatMap((s, i) =>
      s.pe !== null &&
      s.pe < 15 &&
      s.roe > 15 &&
      s.debtToEquity !== null &&
      s.debtToEquity < 0.5 &&
      s.dividendYield > 2
        ? [i]
        : [],
    );
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(0);
  });

  it('agrees with the reference on 300 random nested expressions', () => {
    const rng = createRng(20261001);
    const numeric = NUMERIC_FIELD_LIST.map(f => f.key);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rng.next() * list.length)]!;
    const sample = (field: string): number => {
      const s = model.stocks[Math.floor(rng.next() * model.stocks.length)]!;
      const v = (s as unknown as Record<string, number | null>)[field];
      return v ?? 0;
    };
    const randomCondition = (): Condition => {
      const roll = rng.next();
      if (roll < 0.55) {
        const field = pick(numeric);
        const op = pick(['gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'isNull'] as const);
        const value =
          op === 'between' || op === 'notBetween'
            ? ([sample(field), sample(field)] as [number, number])
            : sample(field);
        return cond(field, op, op === 'isNull' ? undefined : value);
      }
      if (roll < 0.7)
        return cond(pick(numeric), pick(['above', 'below'] as const), undefined, {
          compareTo: pick(numeric),
          multiplier: pick([0.5, 1, 2]),
        });
      if (roll < 0.82)
        return cond('sector', pick(['in', 'notIn'] as const), [
          model.stocks[Math.floor(rng.next() * 500)]!.sector,
        ]);
      if (roll < 0.9)
        return cond('indices', pick(['hasAny', 'hasAll', 'hasNone'] as const), [
          pick(['NIFTY 50', 'SENSEX', 'NIFTY 500', 'BANK NIFTY']),
        ]);
      return cond(pick(Object.keys(BOOLEAN_FIELDS)), pick(['isTrue', 'isFalse'] as const));
    };
    const randomNode = (depth: number): FilterNode => {
      if (depth > 2 || rng.next() < 0.45) return randomCondition();
      const group: Group = {
        kind: 'group',
        id: `g${depth}`,
        combinator: rng.next() < 0.5 ? 'AND' : 'OR',
        negate: rng.next() < 0.2,
        children: Array.from({ length: 1 + Math.floor(rng.next() * 3) }, () =>
          randomNode(depth + 1),
        ),
      };
      return group;
    };

    for (let k = 0; k < 300; k++) {
      const expr = randomNode(0);
      expect(Array.from(engine.screen(expr).indices), JSON.stringify(expr)).toEqual(
        naiveRows(model.stocks, expr),
      );
    }
  }, 60_000); // a property test over 300 expressions × 5,247 rows
});
