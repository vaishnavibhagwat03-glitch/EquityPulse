import { describe, expect, it } from 'vitest';
import { toPrintHtml } from '@/lib/exportPdf';
import { makeStocks } from '../fixtures/market';

describe('PDF export', () => {
  it('builds one escaped table row per stock, preferring live prices', () => {
    const stocks = makeStocks([
      { symbol: 'AAA', name: 'A <b>&</b> Co', price: 10 },
      { symbol: 'BBB', name: 'Beta', price: 20 },
    ]);
    const quotes = new Map([['BBB', { price: 1234.5, changePercent: 2.5 }]]);
    const html = toPrintHtml(stocks, quotes as never, 'My screen');
    expect(html).toContain('<title>My screen</title>');
    expect(html).toContain('2 securities');
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; Co');
    expect(html).toContain('1,234.50');
    expect(html).toContain('+2.50%');
  });
});
