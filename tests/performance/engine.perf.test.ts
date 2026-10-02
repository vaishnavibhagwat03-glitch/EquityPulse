import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { and, cond, FilterEngine, or } from '@/lib/filterEngine';
import { buildColumnStore } from '@/lib/filters/columnStore';
import { generateMarket, toUniverse } from '@/lib/mockDataGenerator';
import { buildSearchIndex, searchStocks } from '@/lib/search';
import { decodeUniverse, encodeUniverse } from '@/lib/universeCodec';
import { useStockStore } from '@/stores/stockStore';
import { FIXED_AS_OF, FIXED_NOW } from '../fixtures/market';

/**
 * Engine-level performance on the full universe, in Node. These are the
 * filter / sort / apply budgets from the specification, measured: each case
 * reports the median and p95 of repeated runs and asserts the budget on the
 * p95. Browser-level numbers (LCP, FPS, memory, tick → paint) come from
 * scripts/measure-runtime.mjs. Set PERF_REPORT=1 to write the results to
 * reports/engine-benchmarks.json for PERFORMANCE_REPORT.md.
 */

interface Result {
  name: string;
  runs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  budgetMs?: number;
}

const results: Result[] = [];

function measure(name: string, runs: number, fn: (i: number) => void, budgetMs?: number): Result {
  fn(-1); // warm-up: JIT, first allocation
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const pick = (q: number): number =>
    Math.round(samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]! * 1000) /
    1000;
  const result = {
    name,
    runs,
    medianMs: pick(0.5),
    p95Ms: pick(0.95),
    maxMs: pick(1),
    ...(budgetMs ? { budgetMs } : {}),
  };
  results.push(result);
  return result;
}

const genStart = performance.now();
const model = generateMarket({ asOf: FIXED_AS_OF, now: FIXED_NOW });
const generationMs = performance.now() - genStart;
const stocks = model.stocks;

/** The five simultaneous filters from the brief's example journey, plus two more. */
const fiveFilters = (pe = 15) =>
  and(
    cond('pe', 'lt', pe),
    cond('roe', 'gt', 15),
    cond('rsi14', 'between', [40, 70]),
    cond('debtToEquity', 'lt', 0.5),
    cond('price', 'above', undefined, { compareTo: 'sma50' }),
  );

afterAll(() => {
  if (!process.env.PERF_REPORT) return;
  mkdirSync('reports', { recursive: true });
  writeFileSync(
    'reports/engine-benchmarks.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: `${process.platform} ${process.arch}`,
          cpu: cpus()[0]?.model,
          cores: cpus().length,
        },
        universe: { securities: stocks.length, generationMs: Math.round(generationMs) },
        results,
      },
      null,
      2,
    ),
  );
});

describe('filter engine on 5,247 securities', () => {
  it('5 simultaneous filters, cold (no cached conditions): p95 < 200 ms', () => {
    const store = buildColumnStore(stocks, model.meta.version);
    const r = measure(
      'filter · 5 conditions · cold',
      30,
      () => {
        new FilterEngine(store).screen(fiveFilters());
      },
      200,
    );
    expect(r.p95Ms).toBeLessThan(200);
  });

  it('5 simultaneous filters while dragging one slider (4 cached, 1 new): p95 < 200 ms', () => {
    const engine = new FilterEngine(buildColumnStore(stocks, model.meta.version));
    const r = measure(
      'filter · 5 conditions · one changed',
      60,
      i => {
        engine.screen(fiveFilters(10 + (i + 1) * 0.25));
      },
      200,
    );
    expect(r.p95Ms).toBeLessThan(200);
  });

  it('5 filters plus sort by market cap: p95 < 200 ms', () => {
    const engine = new FilterEngine(buildColumnStore(stocks, model.meta.version));
    const r = measure(
      'filter + sort · 5 conditions',
      30,
      i => {
        engine.screen(fiveFilters(12 + (i % 10)), {
          sort: { field: 'marketCap', direction: 'desc' },
        });
      },
      200,
    );
    expect(r.p95Ms).toBeLessThan(200);
  });

  it('a 20-condition nested expression: p95 < 200 ms', () => {
    const store = buildColumnStore(stocks, model.meta.version);
    const nested = or(
      and(
        fiveFilters(),
        cond('promoterHolding', 'gt', 50),
        cond('sector', 'in', ['Banking', 'Information Technology']),
      ),
      and(
        cond('revenueGrowth', 'gt', 20),
        cond('profitGrowth', 'gt', 20),
        cond('volume', 'above', undefined, { compareTo: 'avgVolume', multiplier: 2 }),
      ),
      and(
        cond('marketCap', 'gt', 20_000),
        cond('roce', 'gt', 15),
        cond('indices', 'hasAny', ['NIFTY 50']),
      ),
      and(
        cond('pb', 'lt', 3),
        cond('dividendYield', 'gt', 2),
        cond('isProfitable', 'isTrue'),
        cond('beta', 'lt', 1),
      ),
    );
    const r = measure(
      'filter · 20 nested conditions · cold',
      30,
      () => {
        new FilterEngine(store).screen(nested);
      },
      200,
    );
    expect(r.p95Ms).toBeLessThan(200);
  });
});

describe('sorting 5,247 securities', () => {
  it('first sort on a column (full permutation): p95 < 150 ms', () => {
    const store = buildColumnStore(stocks, model.meta.version);
    const fields = ['marketCap', 'pe', 'changePercent', 'roe', 'rsi14', 'volume'];
    const r = measure(
      'sort · cold permutation',
      30,
      i => {
        new FilterEngine(store).screen(null, {
          sort: { field: fields[Math.abs(i) % fields.length]!, direction: 'asc' },
        });
      },
      150,
    );
    expect(r.p95Ms).toBeLessThan(150);
  });

  it('sort by name (string collation): p95 < 150 ms', () => {
    const store = buildColumnStore(stocks, model.meta.version);
    const r = measure(
      'sort · by name · cold',
      15,
      () => {
        new FilterEngine(store).screen(null, { sort: { field: 'name', direction: 'asc' } });
      },
      150,
    );
    expect(r.p95Ms).toBeLessThan(150);
  });
});

describe('live data path', () => {
  it('applies a 500-quote batch to the store: p95 < 16 ms (one frame)', () => {
    useStockStore.getState().setUniverse(toUniverse(model));
    const batch = (k: number) =>
      stocks.slice(0, 500).map(s => ({
        symbol: s.symbol,
        price: s.price * (1 + ((k % 7) - 3) / 1000),
        volume: s.volume + k,
        ts: k,
        rx: 0,
      }));
    const r = measure(
      'store · apply 500 ticks',
      50,
      i => {
        useStockStore.getState().applyTicks(batch(i + 2));
      },
      16,
    );
    expect(r.p95Ms).toBeLessThan(16);
    measure('columns · fold 500 live rows', 20, i => {
      useStockStore.getState().applyTicks(batch(i + 100));
      useStockStore.getState().syncLiveColumns();
    });
  });

  it('decodes the compact universe payload', () => {
    const json = JSON.stringify(encodeUniverse(toUniverse(model)));
    const r = measure('universe · parse + decode 5,247 rows', 10, () => {
      decodeUniverse(JSON.parse(json));
    });
    expect(r.p95Ms).toBeLessThan(500);
    results.push({
      name: `universe payload · ${(json.length / 1024 / 1024).toFixed(2)} MB uncompressed`,
      runs: 1,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
    });
  });

  it('searches the universe per keystroke: p95 < 16 ms', () => {
    const index = buildSearchIndex(stocks);
    const queries = [
      'r',
      're',
      'rel',
      'reli',
      'relia',
      'reliance',
      'hdfc bank',
      'tata',
      'infy',
      'pharma',
    ];
    const r = measure(
      'search · one keystroke',
      100,
      i => {
        searchStocks(index, queries[Math.abs(i) % queries.length]!);
      },
      16,
    );
    expect(r.p95Ms).toBeLessThan(16);
  });
});
