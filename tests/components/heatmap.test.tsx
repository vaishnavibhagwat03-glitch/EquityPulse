import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/exportCsv';
import { groupBySector, heatColor, HeatmapWorkspace } from '@/components/Heatmap/HeatmapWorkspace';
import { makeStocks, market } from '../fixtures/market';
import { loadUniverse, renderWithProviders } from '../helpers/render';

describe('CSV export', () => {
  it('writes a header, escapes quotes/commas and prefers live quotes', () => {
    const [a, b] = makeStocks([
      { symbol: 'AAA', name: 'Acme, "Ltd"', price: 10 },
      { symbol: 'BBB', name: 'Beta', price: 20 },
    ]);
    const quotes = new Map([['BBB', { price: 21, change: 1, changePercent: 5, volume: 7 }]]);
    const lines = toCsv([a!, b!], quotes as never).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.startsWith('symbol,name,exchange')).toBe(true);
    expect(lines[1]).toContain('"Acme, ""Ltd"""');
    expect(lines[2]!.split(',').slice(-12, -8)).toEqual(['21', '1', '5', '7']);
  });
});

describe('heatmap', () => {
  it('colours by direction and stays neutral near zero', () => {
    expect(heatColor(0)).toBe('var(--surface-active)');
    expect(heatColor(2)).toContain('var(--positive)');
    expect(heatColor(-9)).toContain('var(--negative) 55%');
  });

  it('groups the largest companies per sector, biggest sector first', () => {
    const stocks = makeStocks([
      { sector: 'IT', marketCap: 5 },
      { sector: 'IT', marketCap: 50 },
      { sector: 'IT', marketCap: 1 },
      { sector: 'Banks', marketCap: 10 },
    ]);
    const groups = groupBySector(stocks, 2);
    expect(groups.map(g => g.sector)).toEqual(['IT', 'Banks']);
    expect(groups[0]!.stocks.map(s => s.marketCap)).toEqual([50, 5]);
  });

  it('renders tiles that link to stock pages', async () => {
    loadUniverse(market(120));
    renderWithProviders(<HeatmapWorkspace />);
    expect(screen.getByRole('heading', { name: 'Heatmap' })).toBeInTheDocument();
    const links = await screen.findAllByRole('link');
    expect(links.length).toBeGreaterThan(5);
    expect(links[0]!.getAttribute('href')).toMatch(/^\/[A-Z0-9%&-]+/);
  });
});
