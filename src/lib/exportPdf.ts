import type { LiveQuote, Stock } from '@/types/market';
import { formatInteger, formatPercent, formatPrice, formatRatio } from '@/lib/format';

/**
 * PDF export: a print-ready HTML table of the screen, opened in a new window
 * with the browser's print dialog ("Save as PDF"). No PDF library needed.
 */

const COLUMNS: [header: string, cell: (s: Stock, q?: LiveQuote) => string][] = [
  ['Symbol', s => s.symbol],
  ['Name', s => s.name],
  ['Sector', s => s.sector],
  ['LTP (₹)', (s, q) => formatPrice(q?.price ?? s.price)],
  ['Chg %', (s, q) => formatPercent(q?.changePercent ?? s.changePercent, { signed: true })],
  ['M Cap (₹ Cr)', s => formatInteger(s.marketCap)],
  ['P/E', s => formatRatio(s.pe)],
  ['ROE %', s => formatRatio(s.roe)],
  ['RSI 14', s => formatRatio(s.rsi14, 1)],
];

const esc = (v: string): string =>
  v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toPrintHtml(
  stocks: readonly Stock[],
  quotes: ReadonlyMap<string, LiveQuote> | undefined,
  title: string,
): string {
  const head = COLUMNS.map(([h]) => `<th>${esc(h)}</th>`).join('');
  const body = stocks
    .map(s => {
      const q = quotes?.get(s.symbol);
      return `<tr>${COLUMNS.map(([, cell]) => `<td>${esc(cell(s, q))}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:11px system-ui,sans-serif;margin:16px;color:#111}
h1{font-size:15px;margin:0 0 4px}p{margin:0 0 10px;color:#555}
table{border-collapse:collapse;width:100%}th,td{padding:3px 6px;border-bottom:1px solid #ddd;text-align:right}
th:nth-child(-n+3),td:nth-child(-n+3){text-align:left}th{background:#f2f2f2}thead{display:table-header-group}
</style></head><body><h1>${esc(title)}</h1><p>${stocks.length} securities · simulated data · ${esc(new Date().toLocaleString('en-IN'))}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Opens the print dialog for the given document. Returns false if a pop-up blocker stopped it. */
export function printPdf(html: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  return true;
}
