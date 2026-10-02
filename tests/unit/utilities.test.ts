import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';
import {
  direction,
  formatCompact,
  formatCrore,
  formatDate,
  formatInr,
  formatInteger,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatSigned,
  formatTime,
  DASH,
} from '@/lib/format';
import {
  fromIsoDate,
  isoDate,
  istMidnight,
  istWeekday,
  latestSessionDay,
  sessionDays,
  sessionPhase,
} from '@/lib/market/calendar';
import { clamp, createRng, hash32, hashString, lerp, noise, round } from '@/lib/random';
import { buildSearchIndex, fuzzyMatch, searchStocks } from '@/lib/search';
import {
  decodeSparkline,
  encodeSparkline,
  normalise,
  sampleSeries,
  sparklinePoints,
} from '@/lib/sparkline';
import { resolveTheme, THEME_BOOT_SCRIPT } from '@/lib/theme';
import { market } from '../fixtures/market';

describe('number formatting (Indian conventions)', () => {
  it('groups digits the Indian way and pads decimals', () => {
    expect(formatNumber(1234567.891)).toBe('12,34,567.89');
    expect(formatInteger(5247)).toBe('5,247');
    expect(formatInr(1428.3)).toBe('₹1,428.30');
    expect(formatNumber(null)).toBe(DASH);
    expect(formatNumber(Number.NaN)).toBe(DASH);
  });

  it('signs changes with a true minus and shows percentages', () => {
    expect(formatSigned(2.41)).toBe('+2.41');
    expect(formatSigned(-2.41)).toBe('−2.41');
    expect(formatSigned(0)).toBe('0.00');
    expect(formatPercent(1.4215, { signed: true })).toBe('+1.42%');
    expect(formatPercent(-0.5, { signed: true, decimals: 1 })).toBe('−0.5%');
    expect(formatPercent(undefined)).toBe(DASH);
  });

  it('compacts to lakh and crore', () => {
    expect(formatCompact(10_500_000)).toBe('1.05 Cr');
    expect(formatCompact(4_520_000)).toBe('45.20 L');
    expect(formatCompact(8420)).toBe('8,420');
    expect(formatCompact(-2_000_000)).toBe('−20.00 L');
    expect(formatMarketCap(1_977_000)).toBe('₹19.77 L Cr');
    expect(formatMarketCap(82_000)).toBe('₹82,000 Cr');
    expect(formatCrore(0.5)).toBe('₹50.00 L');
    expect(formatCrore(12.345)).toBe('₹12.35 Cr');
  });

  it('shows times in IST whatever the viewer’s timezone', () => {
    const ts = Date.parse('2026-10-01T06:00:05Z');
    expect(formatTime(ts)).toBe('11:30:05');
    expect(formatDate(ts)).toBe('01 Oct 2026');
  });

  it('reports direction with a dead zone at zero', () => {
    expect(direction(0.01)).toBe(1);
    expect(direction(-0.01)).toBe(-1);
    expect(direction(1e-12)).toBe(0);
    expect(direction(null)).toBe(0);
  });
});

describe('NSE calendar', () => {
  const thu = Date.parse('2026-10-01T06:00:00Z'); // Thu 11:30 IST
  const sat = Date.parse('2026-10-03T06:00:00Z');

  it('works in IST days', () => {
    expect(isoDate(istMidnight(thu))).toBe('2026-10-01');
    expect(istWeekday(thu)).toBe(4);
    expect(fromIsoDate('2026-10-01')).toBe(istMidnight(thu));
    // 23:00 UTC on 30 Sep is already 1 Oct in India.
    expect(isoDate(istMidnight(Date.parse('2026-09-30T23:00:00Z')))).toBe('2026-10-01');
  });

  it('knows the session phases', () => {
    expect(sessionPhase(thu)).toBe('OPEN');
    expect(sessionPhase(Date.parse('2026-10-01T03:35:00Z'))).toBe('PRE_OPEN'); // 09:05 IST
    expect(sessionPhase(Date.parse('2026-10-01T10:05:00Z'))).toBe('CLOSED'); // 15:35 IST
    expect(sessionPhase(sat)).toBe('CLOSED');
  });

  it('skips weekends when counting sessions', () => {
    expect(isoDate(latestSessionDay(sat))).toBe('2026-10-02');
    expect(sessionDays(fromIsoDate('2026-10-05'), 3).map(isoDate)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-05',
    ]);
  });
});

describe('deterministic randomness', () => {
  it('repeats exactly for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
    const r = createRng(1);
    for (let i = 0; i < 200; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(r.range(-1, 1)).toBeLessThan(1);
    }
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
    expect(typeof r.chance(0.5)).toBe('boolean');
    expect(Number.isFinite(r.normal())).toBe(true);
  });

  it('hashes stably and offers small numeric helpers', () => {
    expect(hash32(1)).toBe(hash32(1));
    expect(hash32(1)).not.toBe(hash32(2));
    expect(hashString('RELIANCE')).toBe(hashString('RELIANCE'));
    expect(noise(1, 2, 3)).toBe(noise(1, 2, 3));
    expect(clamp(5, 0, 3)).toBe(3);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(round(1.236, 2)).toBe(1.24);
    expect(round(-2.5, 0)).toBe(-2);
  });
});

describe('security search', () => {
  const stocks = market(300).stocks;
  const index = buildSearchIndex(stocks);
  const top = (q: string): string | undefined => {
    const hit = searchStocks(index, q, 5)[0];
    return hit ? stocks[hit.id]!.symbol : undefined;
  };

  it('ranks an exact symbol first, then prefixes and name words', () => {
    expect(top('RELIANCE')).toBe('RELIANCE');
    expect(top('reliance')).toBe('RELIANCE');
    expect(top('tcs')).toBe('TCS');
    const infosys = stocks.find(s => s.symbol === 'INFY')!;
    expect(searchStocks(index, 'infosys', 3).map(h => stocks[h.id]!.symbol)).toContain(
      infosys.symbol,
    );
  });

  it('requires every token to match, and returns nothing for nothing', () => {
    expect(searchStocks(index, '   ')).toEqual([]);
    expect(searchStocks(index, 'zzzzqqq')).toEqual([]);
    for (const hit of searchStocks(index, 'bank hdfc', 8)) {
      const s = stocks[hit.id]!;
      expect(`${s.symbol} ${s.name} ${s.sector} ${s.industry}`.toLowerCase()).toMatch(/hdfc/);
    }
  });

  it('fuzzy-matches command labels', () => {
    expect(fuzzyMatch('Toggle theme', 'tog')).toBe(3);
    expect(fuzzyMatch('Toggle theme', 'theme')).toBe(2);
    expect(fuzzyMatch('Toggle theme', 'tgth')).toBe(1);
    expect(fuzzyMatch('Toggle theme', 'xyz')).toBe(0);
    expect(fuzzyMatch('Anything', '')).toBe(1);
  });
});

describe('sparklines', () => {
  it('quantise to 64 levels and decode to a 0–1 shape', () => {
    const values = [10, 15, 20, 12.5];
    const encoded = encodeSparkline(values);
    expect(encoded).toHaveLength(4);
    const decoded = decodeSparkline(encoded);
    expect(decoded[0]).toBe(0);
    expect(decoded[2]).toBe(1);
    expect(decoded[1]).toBeCloseTo(0.5, 1);
    expect(encodeSparkline([])).toBe('');
    expect(new Set(decodeSparkline(encodeSparkline([3, 3, 3])))).toEqual(
      new Set([decodeSparkline('f')[0]]),
    );
  });

  it('samples, normalises and lays out points', () => {
    expect(sampleSeries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0, 10, 4)).toEqual([0, 3, 6, 9]);
    expect(sampleSeries([1, 2], 0, 2, 5)).toEqual([1, 2]);
    expect(normalise([5, 10, 7.5])).toEqual([0, 1, 0.5]);
    expect(normalise([4, 4])).toEqual([0.5, 0.5]);
    expect(sparklinePoints([0, 1], 10, 10, 0)).toBe('0.0,10.0 10.0,0.0');
    expect(sparklinePoints([1], 10, 10)).toBe('');
  });
});

describe('theme', () => {
  it('resolves "system" from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies the stored preference before paint', () => {
    const run = (stored: string | null, systemDark: boolean): string | undefined => {
      const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
      const fn = new Function('localStorage', 'document', 'window', THEME_BOOT_SCRIPT);
      fn(
        { getItem: () => stored },
        { documentElement: root },
        { matchMedia: () => ({ matches: systemDark }) },
      );
      return root.dataset.theme;
    };
    expect(run('dark', false)).toBe('dark');
    expect(run('system', true)).toBe('dark');
    expect(run(null, true)).toBe('light');
  });

  it('joins class names', () => {
    expect(cn('a', false, null, ['b', ['c']], undefined, 0, 'd')).toBe('a b c d');
  });
});
