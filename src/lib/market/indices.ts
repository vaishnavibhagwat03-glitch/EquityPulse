import type { IndexDefinition } from '@/types/market';

/**
 * Index definitions. Levels are fixed-share, capitalisation-weighted
 * aggregates of the generated constituents, normalised so that the previous
 * close equals `base`:
 *
 *   level(t) = base × Σ shares·price(t) / Σ shares·previousClose
 */
export const HEADLINE_INDICES: readonly IndexDefinition[] = [
  { id: 'NIFTY50', name: 'NIFTY 50', short: 'NIFTY 50', exchange: 'NSE', base: 24520.4 },
  { id: 'SENSEX', name: 'SENSEX', short: 'SENSEX', exchange: 'BSE', base: 80876.35 },
  { id: 'BANKNIFTY', name: 'BANK NIFTY', short: 'BANK NIFTY', exchange: 'NSE', base: 54960.15 },
  { id: 'NIFTYIT', name: 'NIFTY IT', short: 'NIFTY IT', exchange: 'NSE', base: 35610.8 },
];

export const BROAD_INDICES: readonly IndexDefinition[] = [
  { id: 'NIFTYNEXT50', name: 'NIFTY NEXT 50', short: 'NEXT 50', exchange: 'NSE', base: 67840.25 },
  {
    id: 'MIDCAP150',
    name: 'NIFTY MIDCAP 150',
    short: 'MIDCAP 150',
    exchange: 'NSE',
    base: 21380.6,
  },
  {
    id: 'SMALLCAP250',
    name: 'NIFTY SMALLCAP 250',
    short: 'SMALLCAP 250',
    exchange: 'NSE',
    base: 16980.95,
  },
  { id: 'NIFTY500', name: 'NIFTY 500', short: 'NIFTY 500', exchange: 'NSE', base: 22940.1 },
];

export const ALL_INDICES: readonly IndexDefinition[] = [...HEADLINE_INDICES, ...BROAD_INDICES];

/** Membership labels in the order used by the compact bitmask encoding. */
export const INDEX_MEMBERSHIP_LABELS: readonly string[] = ALL_INDICES.map(i => i.name);

export interface MembershipInput {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  marketCap: number;
}

/**
 * Assigns index memberships by rule, mirroring how the real indices are built:
 * NSE indices from NSE-listed names by market-cap rank, sector indices from the
 * largest names in the sector, SENSEX from the 30 largest overall.
 */
export function assignIndexMembership(items: readonly MembershipInput[]): Map<string, string[]> {
  const byCap = [...items].sort((a, b) => b.marketCap - a.marketCap);
  const nse = byCap.filter(s => s.exchange === 'NSE');
  const out = new Map<string, string[]>(items.map(s => [s.symbol, []]));
  const add = (symbol: string, index: string) => out.get(symbol)?.push(index);

  nse.slice(0, 50).forEach(s => add(s.symbol, 'NIFTY 50'));
  byCap.slice(0, 30).forEach(s => add(s.symbol, 'SENSEX'));
  nse
    .filter(s => s.sector === 'Banking')
    .slice(0, 12)
    .forEach(s => add(s.symbol, 'BANK NIFTY'));
  nse
    .filter(s => s.sector === 'Information Technology')
    .slice(0, 10)
    .forEach(s => add(s.symbol, 'NIFTY IT'));
  nse.slice(50, 100).forEach(s => add(s.symbol, 'NIFTY NEXT 50'));
  nse.slice(100, 250).forEach(s => add(s.symbol, 'NIFTY MIDCAP 150'));
  nse.slice(250, 500).forEach(s => add(s.symbol, 'NIFTY SMALLCAP 250'));
  nse.slice(0, 500).forEach(s => add(s.symbol, 'NIFTY 500'));
  return out;
}

export const indexMembershipMask = (memberships: readonly string[]): number => {
  let mask = 0;
  for (const m of memberships) {
    const i = INDEX_MEMBERSHIP_LABELS.indexOf(m);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
};

export const membershipsFromMask = (mask: number): string[] =>
  INDEX_MEMBERSHIP_LABELS.filter((_, i) => (mask & (1 << i)) !== 0);
