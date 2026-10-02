import type { Stock } from '@/types/market';
import { generateMarket, type MarketModel } from '@/lib/mockDataGenerator';

/**
 * Test data comes from the real generator, pinned to one session, so fixtures
 * can never drift from the `Stock` type or from how the app derives fields.
 */

/** Thursday 1 October 2026, 11:30 IST — a regular session, market open. */
export const FIXED_NOW = Date.parse('2026-10-01T06:00:00Z');
export const FIXED_AS_OF = '2026-10-01';

const cache = new Map<number, MarketModel>();

export function market(count = 300): MarketModel {
  let m = cache.get(count);
  if (!m) {
    m = generateMarket({ count, asOf: FIXED_AS_OF, now: FIXED_NOW });
    cache.set(count, m);
  }
  return m;
}

/** The full 5,247-security universe (~2–3 s to generate; cached per test file). */
export const fullMarket = (): MarketModel => market(5247);

/**
 * A hand-made universe: real records with chosen values overridden, so a test
 * can state exactly which rows must match. Row ids follow array positions,
 * as the column store expects.
 */
export function makeStocks(rows: readonly Partial<Stock>[]): Stock[] {
  const template = market(40).stocks[0]!;
  return rows.map((overrides, id) => ({
    ...template,
    indices: [],
    ...overrides,
    id,
    symbol: overrides.symbol ?? `S${id}`,
    name: overrides.name ?? `Stock ${id}`,
  }));
}
