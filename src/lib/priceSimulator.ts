/**
 * Live market engine.
 *
 * Simulates continuous trading on top of the universe snapshot and speaks the
 * feed protocol's data shapes. Runs unchanged inside the `ws` feed server
 * (Node) and the browser feed worker.
 *
 * Price model, per instrument update:
 *
 *   x ← x·e^(−κ·Δt) + β·ΔM + γ·ΔS(sector) + σ_idio·√Δt·z
 *   price = anchor·eˣ, clamped to the circuit band, rounded to the tick size
 *
 * ΔM and ΔS are the moves of shared market / sector factors since this
 * instrument last updated, so instruments ticking at different moments still
 * move together. The Ornstein–Uhlenbeck pull (κ) keeps a long-running session
 * within realistic daily ranges. Market time runs `timeScale`× faster than
 * wall-clock time so a few minutes of viewing shows a meaningful tape.
 *
 * Liquid names tick more often: instruments are sampled in proportion to the
 * square root of their traded value.
 */
import type { Stock } from '@/types/market';
import { ALL_INDICES } from './market/indices';
import {
  computeBreadth,
  computeDistribution,
  computeIndexLevel,
  computeMovers,
  computeSectors,
  type AggregateColumns,
} from './market/aggregates';
import { MARKET_VOL, SECTOR_VOL, roundToTick, tickSizeFor } from './market/pricePath';
import { createRng, type Rng } from './random';
import type { LiveMarket, QuoteTuple, TickTuple } from './feed/protocol';

/** Fields the engine needs from each instrument (a `Stock` satisfies it). */
export type EngineInstrument = Pick<
  Stock,
  | 'symbol'
  | 'name'
  | 'sector'
  | 'price'
  | 'previousClose'
  | 'dayHigh'
  | 'dayLow'
  | 'volume'
  | 'avgVolume'
  | 'sharesOutstanding'
  | 'week52High'
  | 'week52Low'
  | 'beta'
  | 'volatility'
  | 'indices'
>;

export interface EngineOptions {
  /** Average instrument updates per wall-clock second across the universe. */
  ticksPerSecond?: number;
  /** Market seconds per wall-clock second. */
  timeScale?: number;
  /** Mean-reversion speed per market day. */
  reversion?: number;
  seed?: number;
  startTime?: number;
}

/** Seconds in one 09:15–15:30 session. */
const SESSION_SECONDS = 6.25 * 3600;
const SECTOR_LOADING = 0.8;

export class MarketEngine {
  readonly size: number;
  readonly symbols: string[];
  readonly names: string[];
  readonly sectors: string[];

  ticksPerSecond: number;
  readonly timeScale: number;
  private readonly kappa: number;
  private readonly rng: Rng;

  // Static per instrument.
  private readonly anchor: Float64Array;
  private readonly previousClose: Float64Array;
  private readonly shares: Float64Array;
  private readonly avgVolume: Float64Array;
  private readonly beta: Float64Array;
  private readonly idioDaily: Float64Array;
  private readonly band: Float64Array;
  private readonly sectorOf: Uint16Array;
  private readonly cumulativeWeight: Float64Array;
  private readonly moverEligible: Uint8Array;
  private readonly indexDefs: { id: string; base: number; members: number[] }[];

  // Live per instrument.
  readonly price: Float64Array;
  readonly dayHigh: Float64Array;
  readonly dayLow: Float64Array;
  readonly volume: Float64Array;
  readonly week52High: Float64Array;
  readonly week52Low: Float64Array;
  private readonly deviation: Float64Array;
  private readonly lastUpdate: Float64Array;
  private readonly marketAt: Float64Array;
  private readonly sectorAt: Float64Array;

  // Factor state (cumulative log moves).
  private marketLevel = 0;
  private readonly sectorLevels: Float64Array;
  private lastStep: number;
  private seq = 0;

  constructor(instruments: readonly EngineInstrument[], options: EngineOptions = {}) {
    const n = instruments.length;
    this.size = n;
    this.ticksPerSecond = options.ticksPerSecond ?? 120;
    this.timeScale = options.timeScale ?? 20;
    this.kappa = options.reversion ?? 0.22;
    this.rng = createRng(options.seed ?? Date.now() & 0x7fffffff);
    this.lastStep = options.startTime ?? Date.now();

    this.symbols = instruments.map(s => s.symbol);
    this.names = instruments.map(s => s.name);
    this.sectors = instruments.map(s => s.sector);

    const sectorNames = [...new Set(this.sectors)];
    const sectorIndex = new Map(sectorNames.map((s, i) => [s, i]));
    this.sectorLevels = new Float64Array(sectorNames.length);

    this.anchor = new Float64Array(n);
    this.previousClose = new Float64Array(n);
    this.shares = new Float64Array(n);
    this.avgVolume = new Float64Array(n);
    this.beta = new Float64Array(n);
    this.idioDaily = new Float64Array(n);
    this.band = new Float64Array(n);
    this.sectorOf = new Uint16Array(n);
    this.cumulativeWeight = new Float64Array(n);
    this.moverEligible = new Uint8Array(n);
    this.price = new Float64Array(n);
    this.dayHigh = new Float64Array(n);
    this.dayLow = new Float64Array(n);
    this.volume = new Float64Array(n);
    this.week52High = new Float64Array(n);
    this.week52Low = new Float64Array(n);
    this.deviation = new Float64Array(n);
    this.lastUpdate = new Float64Array(n).fill(this.lastStep);
    this.marketAt = new Float64Array(n);
    this.sectorAt = new Float64Array(n);

    let cumulative = 0;
    instruments.forEach((s, i) => {
      this.anchor[i] = s.price;
      this.previousClose[i] = s.previousClose;
      this.shares[i] = s.sharesOutstanding;
      this.avgVolume[i] = s.avgVolume;
      this.price[i] = s.price;
      this.dayHigh[i] = s.dayHigh;
      this.dayLow[i] = s.dayLow;
      this.volume[i] = s.volume;
      this.week52High[i] = s.week52High;
      this.week52Low[i] = s.week52Low;
      this.sectorOf[i] = sectorIndex.get(s.sector) ?? 0;
      this.moverEligible[i] = s.indices.includes('NIFTY 500') ? 1 : 0;

      const beta = Math.max(0.1, s.beta);
      const total = Math.max(0.08, s.volatility / 100);
      const systematic =
        beta * beta * MARKET_VOL * MARKET_VOL + SECTOR_LOADING ** 2 * SECTOR_VOL * SECTOR_VOL;
      this.beta[i] = beta;
      this.idioDaily[i] =
        Math.sqrt(Math.max(total * total - systematic, (0.4 * total) ** 2)) / Math.sqrt(252);
      // NSE-style circuit bands: wider for the most liquid names.
      this.band[i] = s.indices.includes('NIFTY 500') ? 0.2 : i < 2000 ? 0.1 : 0.05;

      cumulative += Math.sqrt(Math.max(1, s.avgVolume * s.price));
      this.cumulativeWeight[i] = cumulative;
    });

    this.indexDefs = ALL_INDICES.map(def => ({
      id: def.id,
      base: def.base,
      members: instruments.flatMap((s, i) => (s.indices.includes(def.name) ? [i] : [])),
    }));
  }

  get sequence(): number {
    return this.seq;
  }

  /** Picks an instrument with probability proportional to its weight. */
  private sample(): number {
    const w = this.cumulativeWeight;
    const target = this.rng.next() * w[w.length - 1]!;
    let lo = 0;
    let hi = w.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (w[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Advances the market to `now` and returns the instruments that traded. */
  step(now = Date.now()): TickTuple[] {
    const dtReal = Math.max(0, (now - this.lastStep) / 1000);
    this.lastStep = now;
    if (dtReal === 0 || this.size === 0) return [];

    const dtDays = (dtReal * this.timeScale) / SESSION_SECONDS;
    const sqrtDt = Math.sqrt(dtDays);
    this.marketLevel += (MARKET_VOL / Math.sqrt(252)) * sqrtDt * this.rng.normal();
    for (let s = 0; s < this.sectorLevels.length; s++) {
      this.sectorLevels[s]! += (SECTOR_VOL / Math.sqrt(252)) * sqrtDt * this.rng.normal();
    }

    const count = Math.max(
      1,
      Math.round(this.ticksPerSecond * dtReal * (0.85 + this.rng.next() * 0.3)),
    );
    const touched = new Map<number, TickTuple>();
    for (let k = 0; k < count; k++) {
      const i = this.sample();
      const tick = this.update(i, now);
      if (tick) touched.set(i, tick);
    }
    if (touched.size) this.seq++;
    return [...touched.values()];
  }

  private update(i: number, now: number): TickTuple | null {
    const elapsedReal = Math.max(0, (now - this.lastUpdate[i]!) / 1000);
    if (elapsedReal <= 0) return null;
    const elapsedDays = Math.min(2, (elapsedReal * this.timeScale) / SESSION_SECONDS);

    const sector = this.sectorOf[i]!;
    const dM = this.marketLevel - this.marketAt[i]!;
    const dS = this.sectorLevels[sector]! - this.sectorAt[i]!;
    const shock =
      this.beta[i]! * dM +
      SECTOR_LOADING * dS +
      this.idioDaily[i]! * Math.sqrt(elapsedDays) * this.rng.normal();
    const x = this.deviation[i]! * Math.exp(-this.kappa * elapsedDays) + shock;

    const prevClose = this.previousClose[i]!;
    const band = this.band[i]!;
    const raw = Math.min(
      prevClose * (1 + band),
      Math.max(prevClose * (1 - band), this.anchor[i]! * Math.exp(x)),
    );
    const price = Math.max(0.01, roundToTick(raw, tickSizeFor(raw)));

    // Keep the deviation consistent with the (possibly clamped) printed price.
    this.deviation[i] = Math.log(price / this.anchor[i]!);
    this.marketAt[i] = this.marketLevel;
    this.sectorAt[i] = this.sectorLevels[sector]!;
    this.lastUpdate[i] = now;

    // Volume accrues at real-time pace so relative volume stays meaningful.
    const move = Math.abs(Math.log(price / Math.max(0.01, this.price[i]!)));
    const traded = Math.round(
      this.avgVolume[i]! *
        (elapsedReal / SESSION_SECONDS) *
        Math.exp(0.5 * this.rng.normal()) *
        (1 + 30 * move),
    );
    this.volume[i] = this.volume[i]! + Math.max(1, traded);
    this.price[i] = price;
    if (price > this.dayHigh[i]!) this.dayHigh[i] = price;
    if (price < this.dayLow[i]!) this.dayLow[i] = price;
    if (price > this.week52High[i]!) this.week52High[i] = price;
    if (price < this.week52Low[i]!) this.week52Low[i] = price;
    return [i, price, this.volume[i]!];
  }

  snapshot(): QuoteTuple[] {
    const out: QuoteTuple[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = [
        this.symbols[i]!,
        this.price[i]!,
        this.dayHigh[i]!,
        this.dayLow[i]!,
        this.volume[i]!,
        this.previousClose[i]!,
      ];
    }
    return out;
  }

  private columns(): AggregateColumns {
    return {
      size: this.size,
      symbol: this.symbols,
      name: this.names,
      sector: this.sectors,
      price: this.price,
      previousClose: this.previousClose,
      volume: this.volume,
      shares: this.shares,
      dayHigh: this.dayHigh,
      dayLow: this.dayLow,
      week52High: this.week52High,
      week52Low: this.week52Low,
      moverEligible: this.moverEligible,
    };
  }

  /** Whole-market aggregates from live prices. */
  market(): LiveMarket {
    const cols = this.columns();
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    return {
      breadth: computeBreadth(cols),
      indices: this.indexDefs.map(def => {
        const level = computeIndexLevel(cols, def);
        return {
          id: def.id,
          value: round2(level.value),
          change: round2(level.value - def.base),
          changePercent: round2(level.changePercent),
          advancing: level.advancing,
          declining: level.declining,
        };
      }),
      sectors: computeSectors(cols).map(s => ({
        name: s.name,
        changePercent: round2(s.changePercent),
        advancing: s.advancing,
        declining: s.declining,
      })),
      movers: computeMovers(cols, 5),
      distribution: computeDistribution(cols),
    };
  }
}
