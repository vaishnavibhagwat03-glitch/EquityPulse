/**
 * Deterministic market universe generator.
 *
 * Produces 5,247 NSE/BSE securities with sector-conditioned fundamentals and
 * technicals computed from a factor-model price history. Everything is a pure
 * function of `(seed, asOf)`: the Next.js API, the `ws` feed server and the
 * in-browser feed worker each generate the same universe independently and
 * agree to the paisa.
 *
 * ALL DATA IS SIMULATED. Real company names anchor identity and scale only.
 */
import type {
  IndexDefinition,
  MacdState,
  MarketCapCategory,
  MarketOverview,
  Stock,
  Universe,
  UniverseMeta,
} from '@/types/market';
import {
  computeBreadth,
  computeDistribution,
  computeIndexLevel,
  computeMovers,
  computeSectors,
  type AggregateColumns,
} from './market/aggregates';
import {
  DAY_MS,
  fromIsoDate,
  isoDate,
  istMidnight,
  sessionPhase,
  sessionOpenTs,
  SESSION_MINUTES,
} from './market/calendar';
import { CURATED_COMPANIES, type CompanyFlag } from './market/companies';
import { ALL_INDICES, assignIndexMembership } from './market/indices';
import { makeCompanyName, makeIsin, makeSymbol } from './market/names';
import {
  buildFactorModel,
  generateDaily,
  intradayBars,
  roundToTick,
  tickSizeFor,
  MARKET_VOL,
  SECTOR_VOL,
  type DailySeries,
  type FactorModel,
  type PathParams,
} from './market/pricePath';
import {
  LENDER_INDUSTRIES,
  NO_LEVERAGE_INDUSTRIES,
  SECTORS,
  SECTOR_BY_NAME,
  SECTOR_NAMES,
  type Band,
  type SectorProfile,
} from './market/sectors';
import { clamp, createRng, hash3, hash32, hashString, lerp, round, type Rng } from './random';
import { encodeSparkline, sampleSeries } from './sparkline';
import { deriveStock, type StockBase } from './stockFields';
import {
  atrLast,
  bollingerLast,
  emaLastPair,
  macdLast,
  rsiLast,
  smaLast,
} from './technicalIndicators';

export const UNIVERSE_SIZE = 5247;
export const BASE_SEED = 0x45515049;
/** Sessions of history used to compute the snapshot's technicals. */
export const SNAPSHOT_DAYS = 260;
/** Sessions shown on index sparklines and overview charts. */
export const INDEX_HISTORY_DAYS = 60;
export const GENERATOR_VERSION = 4;

export interface IndexModel {
  def: IndexDefinition;
  /** Constituent stock ids. */
  members: number[];
  value: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  advancing: number;
  declining: number;
  /** Daily closing levels, oldest first, ending today. */
  history: number[];
  /** Intraday levels for today's session. */
  intraday: number[];
}

/** Server-side model: the public universe plus what history generation needs. */
export interface MarketModel {
  meta: UniverseMeta;
  asOfDay: number;
  factors: FactorModel;
  stocks: Stock[];
  params: PathParams[];
  bySymbol: Map<string, number>;
  indices: IndexModel[];
  industriesBySector: Map<string, string[]>;
  /** Moment the snapshot represents (epoch ms). */
  generatedAt: number;
}

export interface GenerateOptions {
  /** ISO date (YYYY-MM-DD) or epoch ms. Defaults to today in IST. */
  asOf?: string | number;
  count?: number;
  seed?: number;
  /** Clock used for intraday alignment. Defaults to `Date.now()`. */
  now?: number;
}

/** Resolves the snapshot day and the deterministic seed for it. */
export function resolveAsOf(asOf: GenerateOptions['asOf'], now = Date.now()) {
  const asOfDay =
    typeof asOf === 'string'
      ? fromIsoDate(asOf)
      : istMidnight(typeof asOf === 'number' ? asOf : now);
  const dayNumber = Math.round((asOfDay + 5.5 * 3600_000) / DAY_MS);
  return { asOfDay, iso: isoDate(asOfDay), seed: hash32(BASE_SEED ^ dayNumber) };
}

export function universeVersion(seed: number, iso: string, count: number): string {
  return `g${GENERATOR_VERSION}.${iso}.${count}.${seed.toString(36)}`;
}

/* ------------------------------------------------------------------------ */
/* Market-cap structure                                                      */
/* ------------------------------------------------------------------------ */

// Approximate shape of Indian listed market caps (₹ crore) by rank.
const CAP_CURVE: readonly (readonly [number, number])[] = [
  [1, 1_930_000],
  [5, 980_000],
  [10, 590_000],
  [20, 330_000],
  [50, 155_000],
  [100, 82_000],
  [150, 58_000],
  [250, 33_000],
  [500, 15_500],
  [750, 9_000],
  [1000, 5_600],
  [1500, 2_600],
  [2000, 1_250],
  [2500, 650],
  [3000, 380],
  [3500, 220],
  [4000, 130],
  [4500, 70],
  [5000, 35],
  [5247, 18],
];

export function capAtRank(rank: number, count = UNIVERSE_SIZE): number {
  const r = Math.max(1, (rank * UNIVERSE_SIZE) / count);
  for (let k = 1; k < CAP_CURVE.length; k++) {
    const [r1, c1] = CAP_CURVE[k]!;
    if (r <= r1 || k === CAP_CURVE.length - 1) {
      const [r0, c0] = CAP_CURVE[k - 1]!;
      const t = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
      return Math.exp(Math.log(c0) + t * (Math.log(c1) - Math.log(c0)));
    }
  }
  return CAP_CURVE[CAP_CURVE.length - 1]![1];
}

export function categoryForRank(rank: number): MarketCapCategory {
  if (rank <= 100) return 'Large Cap';
  if (rank <= 250) return 'Mid Cap';
  if (rank <= 1000) return 'Small Cap';
  return 'Micro Cap';
}

interface CompanySpec {
  symbol: string;
  name: string;
  sector: SectorProfile;
  industry: string;
  marketCap: number;
  anchor: number;
  promoterHolding: number | null;
  flag?: CompanyFlag;
  curated: boolean;
}

function pickSector(rng: Rng): SectorProfile {
  const total = SECTORS.reduce((a, s) => a + s.weight, 0);
  let x = rng.next() * total;
  for (const s of SECTORS) {
    x -= s.weight;
    if (x <= 0) return s;
  }
  return SECTORS[SECTORS.length - 1]!;
}

function buildSpecs(count: number, rng: Rng): CompanySpec[] {
  const usedSymbols = new Set<string>();
  const usedNames = new Set<string>();
  const specs: CompanySpec[] = [];

  // Curated companies keep their real scale and occupy the top of the market;
  // invented names only ever fill the curve below them, so no fictional
  // company appears among India's largest.
  const curated = [...CURATED_COMPANIES]
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, Math.min(CURATED_COMPANIES.length, Math.floor(count * 0.5)));
  for (const c of curated) {
    usedSymbols.add(c.symbol);
    usedNames.add(c.name);
    // A small daily wobble so each session's snapshot is its own.
    const anchor = c.price * Math.exp(rng.normal() * 0.018);
    specs.push({
      symbol: c.symbol,
      name: c.name,
      sector: SECTOR_BY_NAME.get(c.sector) ?? SECTORS[0]!,
      industry: c.industry,
      marketCap: (c.marketCap * anchor) / c.price,
      anchor,
      promoterHolding: c.promoterHolding,
      flag: c.flag,
      curated: true,
    });
  }

  for (let r = specs.length; r < count; r++) {
    const sector = pickSector(rng);
    const marketCap = capAtRank(r + 1, count) * Math.exp(rng.normal() * 0.07);
    const name = makeCompanyName(rng, sector.nameParts, usedNames);
    const symbol = makeSymbol(name, usedSymbols);
    // Price level loosely tracks size, with the wide dispersion real markets show.
    const median = 16 * Math.pow(marketCap, 0.3);
    const anchor = clamp(median * Math.exp(rng.normal() * 0.8), 1.2, 60_000);
    specs.push({
      symbol,
      name,
      sector,
      industry: rng.pick(sector.industries),
      marketCap,
      anchor,
      promoterHolding: null,
      curated: false,
    });
  }
  return specs.sort((a, b) => b.marketCap - a.marketCap);
}

function exchangeForRank(rank: number, curated: boolean, rng: Rng): 'NSE' | 'BSE' {
  if (curated) return 'NSE';
  const pNse = rank <= 1000 ? 0.97 : rank <= 2000 ? 0.82 : rank <= 3000 ? 0.42 : 0.1;
  return rng.next() < pNse ? 'NSE' : 'BSE';
}

/* ------------------------------------------------------------------------ */
/* Fundamentals                                                              */
/* ------------------------------------------------------------------------ */

const band = (b: Band, t: number): number => lerp(b[0], b[1], clamp(t, 0, 1));

interface FundamentalDraw {
  quality: number;
  growth: number;
  revenueGrowth: number;
  profitGrowth: number;
  loss: boolean;
  roe: number;
  roce: number;
  netMargin: number;
  operatingMargin: number | null;
  debtToEquity: number | null;
  pe: number | null;
  pb: number;
  eps: number;
  dividendYield: number;
  pegRatio: number | null;
  evToEbitda: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  promoterHolding: number;
  fiiHolding: number;
  diiHolding: number;
  publicHolding: number;
  pledgedPercent: number;
  faceValue: number;
}

const SIZE_LOSS_SCALE: Record<MarketCapCategory, number> = {
  'Large Cap': 0.15,
  'Mid Cap': 0.4,
  'Small Cap': 0.9,
  'Micro Cap': 1.6,
};

function drawFundamentals(
  spec: CompanySpec,
  category: MarketCapCategory,
  price: number,
  rng: Rng,
): FundamentalDraw {
  const s = spec.sector;
  const lender = LENDER_INDUSTRIES.has(spec.industry);
  const noLeverage = NO_LEVERAGE_INDUSTRIES.has(spec.industry);
  const psu = spec.flag === 'psu';

  const quality = clamp(0.5 + rng.normal() * 0.22 + (category === 'Large Cap' ? 0.08 : 0), 0, 1);
  const growth = clamp(0.5 + rng.normal() * 0.25, 0, 1);
  const loss = rng.chance(s.lossRate * SIZE_LOSS_SCALE[category] * (spec.curated ? 0.5 : 1));

  let revenueGrowth = band(s.revenueGrowth, growth) + rng.normal() * 4;
  if (loss) revenueGrowth = revenueGrowth * 0.6 - 4;

  const profitGrowth = loss
    ? -(20 + rng.next() * 70)
    : revenueGrowth * lerp(0.6, 1.7, clamp(quality + rng.normal() * 0.2, 0, 1)) + rng.normal() * 7;

  const roe = loss
    ? -(2 + rng.next() * 23)
    : clamp(band(s.roe, quality) + rng.normal() * 2.5, 0.5, 80);
  const netMargin = loss
    ? -(1 + rng.next() * 17)
    : Math.max(0.3, band(s.netMargin, quality) + rng.normal() * 1.5);
  const operatingMargin =
    s.operatingMargin === null || lender
      ? null
      : loss
        ? netMargin + 2 + rng.next() * 6
        : Math.max(netMargin + 2, band(s.operatingMargin, quality) + rng.normal() * 2);

  let debtToEquity: number | null = null;
  if (!noLeverage) {
    const deBand: Band = s.debtToEquity ?? (lender ? [2.5, 6.5] : [0.1, 1.0]);
    debtToEquity = Math.max(0, band(deBand, 1 - quality + rng.normal() * 0.2));
    if (rng.chance(lender ? 0 : 0.14)) debtToEquity = rng.next() * 0.04; // debt-free names
  }

  const roce =
    lender || noLeverage
      ? roe * lerp(0.42, 0.62, rng.next())
      : (debtToEquity !== null ? roe * lerp(1.25, 0.8, clamp(debtToEquity / 2, 0, 1)) : roe) +
        rng.normal() * 1.8;

  let pe: number | null = null;
  if (!loss) {
    const t = clamp(0.55 * growth + 0.45 * quality + rng.normal() * 0.12, 0, 1);
    pe = clamp(band(s.pe, t) * Math.exp(rng.normal() * 0.12) * (psu ? 0.65 : 1), 2.5, 250);
  }
  const eps = pe !== null ? price / pe : -price * (0.01 + rng.next() * 0.11);
  const pb =
    pe !== null
      ? clamp(((pe * roe) / 100) * Math.exp(rng.normal() * 0.12), 0.15, 80)
      : 0.4 + rng.next() * 3.1;

  let dividendYield = 0;
  if (!loss && !rng.chance(spec.curated ? 0.06 : 0.22)) {
    const payout = clamp(
      0.3 + 0.25 * (quality - 0.5) - 0.3 * (growth - 0.5) + rng.normal() * 0.1 + (psu ? 0.22 : 0),
      0.02,
      0.9,
    );
    dividendYield = clamp((payout * 100) / (pe ?? 25), 0, 12);
  }

  const pegRatio = pe !== null && profitGrowth > 1 ? clamp(pe / profitGrowth, 0.05, 25) : null;
  const evToEbitda =
    !loss && operatingMargin !== null && operatingMargin > 0 && pe !== null
      ? clamp(
          pe *
            (netMargin / operatingMargin) *
            (1 + 0.25 * (debtToEquity ?? 0)) *
            Math.exp(rng.normal() * 0.08),
          2,
          120,
        )
      : null;
  const currentRatio =
    lender || noLeverage
      ? null
      : clamp(2.2 - 0.55 * (debtToEquity ?? 0) + rng.normal() * 0.4, 0.35, 6);
  const interestCoverage =
    lender || noLeverage || operatingMargin === null
      ? null
      : clamp(
          (operatingMargin / Math.max(debtToEquity ?? 0, 0.02)) *
            0.35 *
            Math.exp(rng.normal() * 0.25),
          0.4,
          150,
        );

  // Promoter holding is trimodal in Indian listed equity.
  let promoterHolding: number;
  if (spec.promoterHolding !== null) promoterHolding = spec.promoterHolding;
  else {
    const u = rng.next();
    promoterHolding =
      u < 0.08
        ? rng.next() * 14
        : u < 0.2
          ? 51 + rng.next() * 24
          : u < 0.24
            ? 51 + rng.next() * 39
            : 35 + rng.next() * 40;
  }
  const instScale = { 'Large Cap': 1, 'Mid Cap': 0.65, 'Small Cap': 0.3, 'Micro Cap': 0.08 }[
    category
  ];
  let fiiHolding = (8 + rng.next() * 26) * instScale;
  let diiHolding = (6 + rng.next() * 18) * instScale;
  const room = 98 - promoterHolding;
  if (fiiHolding + diiHolding > room) {
    const f = room / (fiiHolding + diiHolding);
    fiiHolding *= f;
    diiHolding *= f;
  }
  const publicHolding = 100 - promoterHolding - fiiHolding - diiHolding;
  const pledgedPercent =
    promoterHolding > 0 &&
    rng.chance(category === 'Large Cap' ? 0.04 : category === 'Mid Cap' ? 0.1 : 0.2)
      ? 1 + rng.next() * (category === 'Large Cap' ? 12 : 44)
      : 0;

  return {
    quality,
    growth,
    revenueGrowth,
    profitGrowth,
    loss,
    roe,
    roce,
    netMargin,
    operatingMargin,
    debtToEquity,
    pe,
    pb,
    eps,
    dividendYield,
    pegRatio,
    evToEbitda,
    currentRatio,
    interestCoverage,
    promoterHolding,
    fiiHolding,
    diiHolding,
    publicHolding,
    pledgedPercent,
    faceValue: rng.pick([1, 1, 2, 2, 5, 10, 10, 10] as const),
  };
}

/* ------------------------------------------------------------------------ */
/* Price model parameters                                                    */
/* ------------------------------------------------------------------------ */

const BASE_VOL: Record<MarketCapCategory, number> = {
  'Large Cap': 0.23,
  'Mid Cap': 0.29,
  'Small Cap': 0.36,
  'Micro Cap': 0.43,
};

function drawPathParams(
  spec: CompanySpec,
  category: MarketCapCategory,
  seed: number,
  growth: number,
  rng: Rng,
): PathParams {
  const s = spec.sector;
  const total = clamp(BASE_VOL[category] * s.volatility * Math.exp(rng.normal() * 0.15), 0.14, 0.9);
  const sizeBeta = category === 'Micro Cap' ? 0.8 : category === 'Small Cap' ? 0.92 : 1;
  const beta = lerp(s.beta[0], s.beta[1], rng.next()) * sizeBeta;
  const gamma = 0.55 + rng.next() * 0.5;
  const systematic =
    beta * beta * MARKET_VOL * MARKET_VOL + gamma * gamma * SECTOR_VOL * SECTOR_VOL;
  const idioVol = Math.sqrt(Math.max(total * total - systematic, (0.4 * total) ** 2));
  // The market factor already carries the equity premium; this is stock alpha.
  const drift = clamp(0.02 + rng.normal() * 0.12 + (growth - 0.5) * 0.2, -0.35, 0.45);

  const turnoverRatio =
    { 'Large Cap': 0.0008, 'Mid Cap': 0.0016, 'Small Cap': 0.0024, 'Micro Cap': 0.0014 }[category] *
    Math.exp(rng.normal() * 0.5);
  const avgVolume = Math.max(200, (spec.marketCap * 1e7 * turnoverRatio) / spec.anchor);

  return {
    seed,
    sector: s.name,
    anchor: spec.anchor,
    beta,
    gamma,
    idioVol,
    drift,
    avgVolume,
    tickSize: tickSizeFor(spec.anchor),
    eventToday: category === 'Micro Cap' || category === 'Small Cap' ? 0.06 : 0.035,
    // A results surprise moves a mega-cap a few percent, a micro-cap far more.
    eventScale: { 'Large Cap': 2.2, 'Mid Cap': 3, 'Small Cap': 3.8, 'Micro Cap': 4.5 }[category],
  };
}

/* ------------------------------------------------------------------------ */
/* Technicals from the generated path                                        */
/* ------------------------------------------------------------------------ */

function macdState(m: ReturnType<typeof macdLast>): MacdState {
  if (m.line === null || m.signal === null) return 'NEUTRAL';
  const d = m.line - m.signal;
  const p = m.prevLine !== null && m.prevSignal !== null ? m.prevLine - m.prevSignal : d;
  if (d > 0 && p <= 0) return 'BULLISH_CROSS';
  if (d < 0 && p >= 0) return 'BEARISH_CROSS';
  if (d > 0) return 'BULLISH';
  if (d < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function estimateBeta(series: DailySeries, f: FactorModel, window = 252): number {
  const n = series.length;
  const len = Math.min(window, n);
  let sr = 0;
  let sm = 0;
  for (let t = 0; t < len; t++) {
    sr += series.returns[n - 1 - t]!;
    sm += f.market[t]!;
  }
  const mr = sr / len;
  const mm = sm / len;
  let cov = 0;
  let vm = 0;
  for (let t = 0; t < len; t++) {
    const dr = series.returns[n - 1 - t]! - mr;
    const dm = f.market[t]! - mm;
    cov += dr * dm;
    vm += dm * dm;
  }
  return vm > 0 ? cov / vm : 1;
}

function realisedVol(series: DailySeries, window = 60): number {
  const n = series.length;
  const len = Math.min(window, n);
  let s = 0;
  let sq = 0;
  for (let k = n - len; k < n; k++) {
    const r = series.returns[k]!;
    s += r;
    sq += r * r;
  }
  const mean = s / len;
  return Math.sqrt(Math.max(0, sq / len - mean * mean)) * Math.sqrt(252) * 100;
}

const pct = (a: number, b: number): number => (b ? (a / b - 1) * 100 : 0);

/* ------------------------------------------------------------------------ */
/* Universe                                                                  */
/* ------------------------------------------------------------------------ */

/** Fraction of an average day's volume printed so far in the snapshot. */
const SNAPSHOT_VOLUME_FRACTION = 0.74;

export function generateMarket(options: GenerateOptions = {}): MarketModel {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = options.now ?? Date.now();
  const count = options.count ?? UNIVERSE_SIZE;
  const { asOfDay, iso, seed: daySeed } = resolveAsOf(options.asOf, now);
  const seed = options.seed ?? daySeed;

  const rng = createRng(seed);
  const factors = buildFactorModel(seed, SECTOR_NAMES);
  const specs = buildSpecs(count, rng);

  const exchanges = specs.map((s, i) => exchangeForRank(i + 1, s.curated, rng));
  const memberships = assignIndexMembership(
    specs.map((s, i) => ({
      symbol: s.symbol,
      exchange: exchanges[i]!,
      sector: s.sector.name,
      marketCap: s.marketCap,
    })),
  );

  const stocks: Stock[] = new Array(count);
  const params: PathParams[] = new Array(count);
  const closes: Float64Array[] = []; // retained only for index constituents
  const indexMemberIds = new Map<string, number[]>(ALL_INDICES.map(d => [d.name, []]));

  for (let id = 0; id < count; id++) {
    const spec = specs[id]!;
    const rank = id + 1;
    const category = categoryForRank(rank);
    const symbolHash = hashString(spec.symbol);
    const fundRng = createRng(hash3(seed, symbolHash, 3));
    const pathRng = createRng(hash3(seed, symbolHash, 5));

    // Paths are anchored, so today's price is known before the path exists and
    // fundamentals can be drawn first; growth then tilts the historical drift.
    const anchor = roundToTick(spec.anchor, tickSizeFor(spec.anchor));
    const f = drawFundamentals(spec, category, anchor, fundRng);
    const p = drawPathParams(
      { ...spec, anchor },
      category,
      hash3(seed, symbolHash, 7),
      f.growth,
      pathRng,
    );
    params[id] = p;

    const series = generateDaily(p, factors, SNAPSHOT_DAYS, asOfDay);
    const n = series.length;
    const C = series.close;
    const H = series.high;
    const L = series.low;
    const V = series.volume;

    const price = C[n - 1]!;
    const previousClose = C[n - 2]!;

    let avgVolume = 0;
    for (let k = n - 21; k < n - 1; k++) avgVolume += V[k]!;
    avgVolume /= 20;
    const volume = Math.max(1, Math.round(V[n - 1]! * SNAPSHOT_VOLUME_FRACTION));

    let week52High = -Infinity;
    let week52Low = Infinity;
    for (let k = Math.max(0, n - 252); k < n; k++) {
      if (H[k]! > week52High) week52High = H[k]!;
      if (L[k]! < week52Low) week52Low = L[k]!;
    }

    const sma20 = smaLast(C, n, 20) ?? price;
    const sma50 = smaLast(C, n, 50) ?? price;
    const sma200 = smaLast(C, n, 200) ?? price;
    const ema12 = emaLastPair(C, n, 12)[1] ?? price;
    const ema26 = emaLastPair(C, n, 26)[1] ?? price;
    const m = macdLast(C, n);
    const bb = bollingerLast(C, n, 20, 2) ?? { upper: price, middle: price, lower: price };
    const atr14 = atrLast(H, L, C, n, 14) ?? price * 0.02;

    const sharesOutstanding = spec.marketCap / spec.anchor;
    const indices = memberships.get(spec.symbol) ?? [];
    for (const name of indices) indexMemberIds.get(name)?.push(id);
    if (indices.length && indices.some(x => x !== 'NIFTY 500')) closes[id] = C;

    // Per-share anchors for the valuation ratios, so P/E, P/B and yield can be
    // re-derived at any live price (see lib/stockFields.ts).
    const eps = round(f.eps, 2);
    const bookValue = round(price / f.pb, 2);
    const dividendPerShare = round((f.dividendYield * price) / 100, 2);

    const base: StockBase = {
      id,
      symbol: spec.symbol,
      name: spec.name,
      exchange: exchanges[id]!,
      isin: makeIsin(id + 1),
      sector: spec.sector.name,
      industry: spec.industry,
      marketCapCategory: category,
      indices,

      price,
      previousClose,
      open: series.open[n - 1]!,
      dayHigh: H[n - 1]!,
      dayLow: L[n - 1]!,
      volume,
      avgVolume: Math.round(avgVolume),
      week52High,
      week52Low,
      return1W: round(pct(price, C[n - 6]!), 2),
      return1M: round(pct(price, C[n - 22]!), 2),
      return3M: round(pct(price, C[n - 64]!), 2),
      return6M: round(pct(price, C[n - 127]!), 2),
      return1Y: round(pct(price, C[n - 253]!), 2),

      sharesOutstanding: round(sharesOutstanding, 4),
      faceValue: f.faceValue,
      eps,
      bookValue,
      dividendPerShare,
      roe: round(f.roe, 2),
      roce: round(f.roce, 2),
      debtToEquity: f.debtToEquity === null ? null : round(f.debtToEquity, 2),
      revenueGrowth: round(f.revenueGrowth, 2),
      profitGrowth: round(f.profitGrowth, 2),
      operatingMargin: f.operatingMargin === null ? null : round(f.operatingMargin, 2),
      netMargin: round(f.netMargin, 2),
      evToEbitda: f.evToEbitda === null ? null : round(f.evToEbitda, 2),
      currentRatio: f.currentRatio === null ? null : round(f.currentRatio, 2),
      interestCoverage: f.interestCoverage === null ? null : round(f.interestCoverage, 2),
      promoterHolding: round(f.promoterHolding, 2),
      fiiHolding: round(f.fiiHolding, 2),
      diiHolding: round(f.diiHolding, 2),
      pledgedPercent: round(f.pledgedPercent, 2),

      sma20: round(sma20, 2),
      sma50: round(sma50, 2),
      sma200: round(sma200, 2),
      ema12: round(ema12, 2),
      ema26: round(ema26, 2),
      rsi14: round(rsiLast(C, n, 14) ?? 50, 2),
      macd: round(m.line ?? 0, 3),
      macdSignal: round(m.signal ?? 0, 3),
      macdState: macdState(m),
      bbUpper: round(bb.upper, 2),
      bbMiddle: round(bb.middle, 2),
      bbLower: round(bb.lower, 2),
      atr14: round(atr14, 2),
      beta: round(estimateBeta(series, factors), 2),
      volatility: round(realisedVol(series), 2),
      // One month of closes, sampled to 16 points for a 64px sparkline.
      spark: encodeSparkline(sampleSeries(C, n - 22, n, 16)),
    };
    stocks[id] = deriveStock(base);
  }

  const bySymbol = new Map(stocks.map(s => [s.symbol, s.id]));
  const industriesBySector = new Map(SECTORS.map(s => [s.name, [...s.industries]]));
  const indices = buildIndices(stocks, params, closes, indexMemberIds, now);

  const generatedMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  );
  return {
    meta: { version: universeVersion(seed, iso, count), seed, asOf: iso, count, generatedMs },
    asOfDay,
    factors,
    stocks,
    params,
    bySymbol,
    indices,
    industriesBySector,
    generatedAt: now,
  };
}

/** Where today's intraday bars sit on the clock: the real session when it is
 *  open, otherwise a trailing session-length window ending now. */
export function todaySessionWindow(now: number): { start: number; steps: number } {
  const fiveMin = 5 * 60_000;
  if (sessionPhase(now) === 'OPEN') {
    const start = sessionOpenTs(istMidnight(now));
    return { start, steps: Math.max(6, Math.floor((now - start) / fiveMin)) };
  }
  const end = Math.floor(now / fiveMin) * fiveMin;
  return { start: end - SESSION_MINUTES * 60_000, steps: 75 };
}

function buildIndices(
  stocks: Stock[],
  params: PathParams[],
  closes: Float64Array[],
  memberIds: Map<string, number[]>,
  now: number,
): IndexModel[] {
  const window = todaySessionWindow(now);
  const intradayCache = new Map<number, number[]>();
  const intradayCloses = (id: number): number[] => {
    let cached = intradayCache.get(id);
    if (!cached) {
      const s = stocks[id]!;
      const bars = intradayBars(
        params[id]!,
        0,
        { open: s.open, high: s.dayHigh, low: s.dayLow, close: s.price, volume: s.volume },
        window.start,
        window.steps,
      );
      cached = [s.open, ...bars.map(b => b.close)];
      intradayCache.set(id, cached);
    }
    return cached;
  };

  return ALL_INDICES.map(def => {
    const members = memberIds.get(def.name) ?? [];
    const headline =
      def.id === 'NIFTY50' || def.id === 'SENSEX' || def.id === 'BANKNIFTY' || def.id === 'NIFTYIT';
    let prevSum = 0;
    let nowSum = 0;
    let advancing = 0;
    let declining = 0;
    for (const id of members) {
      const s = stocks[id]!;
      prevSum += s.sharesOutstanding * s.previousClose;
      nowSum += s.sharesOutstanding * s.price;
      if (s.price > s.previousClose) advancing++;
      else if (s.price < s.previousClose) declining++;
    }
    const level = (sum: number): number => (prevSum ? (def.base * sum) / prevSum : def.base);

    const history: number[] = [];
    if (members.length && members.every(id => closes[id])) {
      const n = closes[members[0]!]!.length;
      for (let k = n - INDEX_HISTORY_DAYS; k < n; k++) {
        let sum = 0;
        for (const id of members) sum += stocks[id]!.sharesOutstanding * closes[id]![k]!;
        history.push(round(level(sum), 2));
      }
    }

    let intraday: number[] = [];
    if (headline && members.length) {
      const len = window.steps + 1;
      const sums = new Float64Array(len);
      for (const id of members) {
        const path = intradayCloses(id);
        const sh = stocks[id]!.sharesOutstanding;
        for (let k = 0; k < len; k++) sums[k]! += sh * path[k]!;
      }
      intraday = Array.from(sums, v => round(level(v), 2));
    }

    const value = level(nowSum);
    return {
      def,
      members,
      value: round(value, 2),
      previousClose: def.base,
      change: round(value - def.base, 2),
      changePercent: round((value / def.base - 1) * 100, 2),
      dayHigh: round(intraday.length ? Math.max(...intraday) : Math.max(value, def.base), 2),
      dayLow: round(intraday.length ? Math.min(...intraday) : Math.min(value, def.base), 2),
      advancing,
      declining,
      history,
      intraday,
    };
  });
}

export function aggregateColumnsFromStocks(stocks: readonly Stock[]): AggregateColumns {
  return {
    size: stocks.length,
    symbol: stocks.map(s => s.symbol),
    name: stocks.map(s => s.name),
    sector: stocks.map(s => s.sector),
    price: stocks.map(s => s.price),
    previousClose: stocks.map(s => s.previousClose),
    volume: stocks.map(s => s.volume),
    shares: stocks.map(s => s.sharesOutstanding),
    dayHigh: stocks.map(s => s.dayHigh),
    dayLow: stocks.map(s => s.dayLow),
    week52High: stocks.map(s => s.week52High),
    week52Low: stocks.map(s => s.week52Low),
    moverEligible: stocks.map(s => (s.indices.includes('NIFTY 500') ? 1 : 0)),
  };
}

/** Static market overview for the snapshot (server-rendered home page). */
export function buildOverview(model: MarketModel): MarketOverview {
  const cols = aggregateColumnsFromStocks(model.stocks);
  return {
    asOf: model.generatedAt,
    breadth: computeBreadth(cols),
    indices: model.indices.map(({ def, members: _members, ...rest }) => ({ ...def, ...rest })),
    sectors: computeSectors(cols, model.industriesBySector),
    movers: computeMovers(cols, 5),
    distribution: computeDistribution(cols),
  };
}

export { computeIndexLevel };

export function toUniverse(model: MarketModel): Universe {
  return { meta: model.meta, stocks: model.stocks };
}
