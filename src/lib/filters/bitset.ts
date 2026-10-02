/**
 * Fixed-size bitset over row positions.
 *
 * Each condition's result is one bit per stock: 5,247 rows fit in 164 words,
 * so combining conditions with AND/OR/NOT is ~164 integer operations instead
 * of a pass over 5,247 objects. Condition results are cached as bitsets and
 * treated as immutable; group evaluation always works on a copy.
 */
export class Bitset {
  readonly size: number;
  readonly words: Uint32Array;

  constructor(size: number, words?: Uint32Array) {
    this.size = size;
    this.words = words ?? new Uint32Array((size + 31) >>> 5);
  }

  static empty(size: number): Bitset {
    return new Bitset(size);
  }

  static full(size: number): Bitset {
    return new Bitset(size).fill();
  }

  clone(): Bitset {
    return new Bitset(this.size, this.words.slice());
  }

  fill(): this {
    this.words.fill(0xffffffff);
    this.trim();
    return this;
  }

  /** Clears the unused high bits of the last word so counts stay exact. */
  private trim(): void {
    const rem = this.size & 31;
    if (rem && this.words.length) this.words[this.words.length - 1]! &= 2 ** rem - 1;
  }

  set(i: number): void {
    this.words[i >>> 5]! |= 1 << (i & 31);
  }

  has(i: number): boolean {
    return (this.words[i >>> 5]! & (1 << (i & 31))) !== 0;
  }

  and(other: Bitset): this {
    const a = this.words;
    const b = other.words;
    for (let k = 0; k < a.length; k++) a[k]! &= b[k]!;
    return this;
  }

  or(other: Bitset): this {
    const a = this.words;
    const b = other.words;
    for (let k = 0; k < a.length; k++) a[k]! |= b[k]!;
    return this;
  }

  not(): this {
    const a = this.words;
    for (let k = 0; k < a.length; k++) a[k] = ~a[k]! >>> 0;
    this.trim();
    return this;
  }

  isEmpty(): boolean {
    const a = this.words;
    for (let k = 0; k < a.length; k++) if (a[k]) return false;
    return true;
  }

  count(): number {
    let total = 0;
    const a = this.words;
    for (let k = 0; k < a.length; k++) {
      // SWAR popcount.
      let v = a[k]!;
      v -= (v >>> 1) & 0x55555555;
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
      total += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    return total;
  }

  /** Set positions in ascending order. */
  toIndices(): Uint32Array {
    const out = new Uint32Array(this.count());
    let n = 0;
    const a = this.words;
    for (let k = 0; k < a.length; k++) {
      let v = a[k]!;
      while (v) {
        const t = v & -v;
        out[n++] = (k << 5) + (31 - Math.clz32(t));
        v ^= t;
      }
    }
    return out;
  }
}
