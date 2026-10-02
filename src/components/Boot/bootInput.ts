import type { MarketOverview } from '@/types/market';
import { formatInr, formatInteger } from '@/lib/format';

/**
 * What the boot sequence shows, derived from the server snapshot on the
 * server: a few hundred bytes instead of the overview itself. Every figure
 * in the sequence is a real value from the session being loaded.
 */

export interface BootReadout {
  label: string;
  value: number;
  changePercent: number;
}

export interface BootInput {
  securities: number;
  sectors: { count: number; advancing: number; declining: number }[];
  /** NIFTY 50 intraday levels. */
  trace: number[];
  readouts: BootReadout[];
  /** Short fragments that settle beneath the grid. */
  meta: string[];
}

const PRIMARY = ['NIFTY50', 'SENSEX', 'BANKNIFTY', 'NIFTYIT'];

export function bootInputFromOverview(overview: MarketOverview): BootInput {
  const byId = new Map(overview.indices.map(i => [i.id, i]));
  const primary = PRIMARY.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const active = overview.movers.active[0];
  const { breadth } = overview;
  return {
    securities: breadth.total,
    sectors: overview.sectors.map(s => ({
      count: s.count,
      advancing: s.advancing,
      declining: s.declining,
    })),
    trace: byId.get('NIFTY50')?.intraday ?? [],
    readouts: primary.map(i => ({ label: i.name, value: i.value, changePercent: i.changePercent })),
    meta: [
      `${formatInteger(breadth.total)} securities`,
      'NSE',
      'BSE',
      `${formatInteger(breadth.advancing)} adv`,
      `${formatInteger(breadth.declining)} dec`,
      ...(active ? [`${active.symbol} ${formatInr(active.price)}`] : []),
      'Live feed',
    ],
  };
}
