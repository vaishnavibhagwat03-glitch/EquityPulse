import type { Bitset } from './bitset';
import type { ColumnStore } from './columnStore';
import { isLiveField } from './fields';

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/**
 * Sorting by permutation.
 *
 * The first sort on a column orders *all* rows once (O(n log n)) and caches
 * the permutation. Any filtered view sorted on that column is then a single
 * O(n) walk of the permutation, keeping only rows whose bit is set. Toggling
 * filters under a fixed sort never re-sorts. Nulls always sort last; ties fall
 * back to universe order (market-cap rank), so the order is stable.
 */
export class Sorter {
  private readonly cache = new Map<string, Uint32Array>();
  lastSortMs = 0;

  clear(): void {
    this.cache.clear();
  }

  private key(store: ColumnStore, spec: SortSpec): string {
    const live = isLiveField(spec.field) ? `@${store.liveVersion}` : '';
    return `${store.version}|${spec.field}|${spec.direction}${live}`;
  }

  permutation(store: ColumnStore, spec: SortSpec): Uint32Array {
    const key = this.key(store, spec);
    const cached = this.cache.get(key);
    if (cached) {
      this.lastSortMs = 0;
      return cached;
    }
    const t0 = performance.now();
    const n = store.size;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const dir = spec.direction === 'asc' ? 1 : -1;

    const numeric = store.numbers.get(spec.field);
    if (numeric) {
      idx.sort((a, b) => {
        const x = numeric[a]!;
        const y = numeric[b]!;
        const xn = x !== x;
        const yn = y !== y;
        if (xn || yn) return xn === yn ? a - b : xn ? 1 : -1;
        if (x === y) return a - b;
        return x < y ? -dir : dir;
      });
    } else {
      const rank = this.textRanks(store, spec.field);
      idx.sort((a, b) => (rank[a] === rank[b] ? a - b : (rank[a]! - rank[b]!) * dir));
    }

    // Live keys invalidate often; keep the cache small and recent.
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, idx);
    this.lastSortMs = performance.now() - t0;
    return idx;
  }

  /** Rows of `bits`, in sorted order. */
  subset(store: ColumnStore, bits: Bitset, spec: SortSpec): Uint32Array {
    const perm = this.permutation(store, spec);
    const out = new Uint32Array(bits.count());
    const words = bits.words;
    let k = 0;
    for (let j = 0; j < perm.length; j++) {
      const i = perm[j]!;
      if (words[i >>> 5]! & (1 << (i & 31))) out[k++] = i;
    }
    return out;
  }

  private textRanks(store: ColumnStore, field: string): Uint32Array {
    const n = store.size;
    const rank = new Uint32Array(n);
    const category = store.categories.get(field);
    if (category) {
      const order = category.dictionary
        .map((v, code) => ({ v, code }))
        .sort((a, b) => a.v.localeCompare(b.v));
      const codeRank = new Uint32Array(category.dictionary.length);
      order.forEach((o, r) => (codeRank[o.code] = r));
      for (let i = 0; i < n; i++) rank[i] = codeRank[category.codes[i]!]!;
      return rank;
    }
    // Symbol (default) or name: rank by string.
    const values = field === 'name' ? store.names : store.symbols;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
      values[a]! < values[b]! ? -1 : values[a]! > values[b]! ? 1 : 0,
    );
    order.forEach((i, r) => (rank[i] = r));
    return rank;
  }
}
