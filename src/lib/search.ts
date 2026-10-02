import type { Stock } from '@/types/market';

/**
 * Security search for the command palette.
 *
 * Ranking (higher wins): exact symbol > symbol prefix > word prefix in the
 * name > symbol substring > name substring > sector/industry match. Every
 * token of a multi-word query must match somewhere. Ties go to the larger
 * company (universe order is market-cap rank). One pass over precomputed
 * lower-case strings: ~1 ms for 5,247 securities per keystroke.
 */

export interface SearchIndex {
  ids: Int32Array;
  symbols: string[];
  names: string[];
  words: string[][];
  classes: string[];
}

export function buildSearchIndex(stocks: readonly Stock[]): SearchIndex {
  return {
    ids: Int32Array.from(stocks, s => s.id),
    symbols: stocks.map(s => s.symbol.toLowerCase()),
    names: stocks.map(s => s.name.toLowerCase()),
    words: stocks.map(s =>
      s.name
        .toLowerCase()
        .replace(/[^a-z0-9& ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean),
    ),
    classes: stocks.map(s => `${s.sector} ${s.industry}`.toLowerCase()),
  };
}

function scoreToken(index: SearchIndex, i: number, token: string): number {
  const symbol = index.symbols[i]!;
  if (symbol === token) return 1000;
  if (symbol.startsWith(token)) return 800 - Math.min(100, symbol.length - token.length);
  if (index.words[i]!.some(w => w.startsWith(token))) return 600;
  if (symbol.includes(token)) return 400;
  if (index.names[i]!.includes(token)) return 300;
  if (index.classes[i]!.includes(token)) return 120;
  return 0;
}

export interface SearchHit {
  id: number;
  score: number;
}

export function searchStocks(index: SearchIndex, query: string, limit = 8): SearchHit[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hits: SearchHit[] = [];
  const n = index.symbols.length;
  for (let i = 0; i < n; i++) {
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      const s = scoreToken(index, i, token);
      if (!s) {
        ok = false;
        break;
      }
      total += s;
    }
    if (!ok) continue;
    // Universe order is market-cap rank: nudge larger companies up within a tier.
    hits.push({ id: index.ids[i]!, score: total - i / n });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Case-insensitive fuzzy match for command labels: every query char in order. */
export function fuzzyMatch(label: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (l.includes(q)) return 2;
  let j = 0;
  for (let i = 0; i < l.length && j < q.length; i++) if (l[i] === q[j]) j++;
  return j === q.length ? 1 : 0;
}
