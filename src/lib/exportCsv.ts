import type { LiveQuote, Stock } from '@/types/market';

/** Columns written to the CSV, in order. Live fields come from the quote when present. */
const FIELDS = [
  'symbol',
  'name',
  'exchange',
  'sector',
  'industry',
  'marketCapCategory',
  'price',
  'change',
  'changePercent',
  'volume',
  'marketCap',
  'pe',
  'pb',
  'roe',
  'roce',
  'debtToEquity',
  'dividendYield',
  'rsi14',
] as const satisfies readonly (keyof Stock)[];

const escape = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(stocks: readonly Stock[], quotes?: ReadonlyMap<string, LiveQuote>): string {
  const lines = [FIELDS.join(',')];
  for (const stock of stocks) {
    const q = quotes?.get(stock.symbol);
    const row = q
      ? {
          ...stock,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
        }
      : stock;
    lines.push(FIELDS.map(f => escape(row[f])).join(','));
  }
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
