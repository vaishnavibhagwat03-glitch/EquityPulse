import type { Fundamentals, QuarterlyResult, ShareholdingPoint, Stock } from '@/types/market';
import { createRng, hashString, round } from '@/lib/random';
import { IST_OFFSET_MS } from './calendar';

/**
 * Detailed fundamentals for the stock page, derived from the snapshot record so
 * every figure reconciles with the screener (TTM profit = EPS × shares, and so
 * on). Deterministic per (universe seed, symbol). SIMULATED.
 */

const QUARTER_END_MONTHS = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-based)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The most recent quarter whose results would be published by `asOf` (≈45 days lag). */
function latestReportedQuarter(asOfMs: number): { year: number; month: number } {
  const d = new Date(asOfMs + IST_OFFSET_MS - 45 * 86_400_000);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  while (!QUARTER_END_MONTHS.includes(month)) {
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
  }
  return { year, month };
}

function quarterLabels(asOfMs: number, count: number): string[] {
  let { year, month } = latestReportedQuarter(asOfMs);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${MONTHS[month]} ${year}`);
    month -= 3;
    if (month < 0) {
      month += 12;
      year--;
    }
  }
  return out;
}

export function buildFundamentals(stock: Stock, seed: number, asOfMs: number): Fundamentals {
  const rng = createRng(hashString(stock.symbol) ^ seed);
  const shares = stock.sharesOutstanding; // crore
  const netProfitTTM = stock.eps * shares; // ₹ crore
  const margin = Math.abs(stock.netMargin) > 0.2 ? stock.netMargin : 0.2;
  const revenueTTM = Math.abs(netProfitTTM / (margin / 100));
  const opm = stock.operatingMargin ?? Math.max(margin + 8, 12);
  const ebitdaTTM = (revenueTTM * opm) / 100;
  const equity = stock.bookValue * shares;
  const totalDebt = Math.max(0, (stock.debtToEquity ?? 0) * equity);
  const cash = equity * (0.04 + rng.next() * 0.22);

  const g = stock.revenueGrowth / 100;
  const labels = quarterLabels(asOfMs, 8);
  const quarterly: QuarterlyResult[] = labels.map((period, k) => {
    // k = 0 is the latest quarter; revenue compounds forward at the YoY rate.
    const scale = Math.pow(1 + g, -k / 4) * (1 + Math.sin(k * 1.7 + rng.next()) * 0.035);
    const revenue = (revenueTTM / 4) * scale * (0.97 + rng.next() * 0.06);
    const npMargin = margin * (0.85 + rng.next() * 0.3);
    const netProfit =
      netProfitTTM >= 0 ? (revenue * npMargin) / 100 : -(revenue * Math.abs(npMargin)) / 100;
    return {
      period,
      revenue: round(revenue, 2),
      operatingProfit: round((revenue * opm * (0.9 + rng.next() * 0.2)) / 100, 2),
      netProfit: round(netProfit, 2),
      eps: round(shares > 0 ? netProfit / shares : 0, 2),
    };
  });

  const fyEnd =
    latestReportedQuarter(asOfMs).year - (latestReportedQuarter(asOfMs).month < 2 ? 1 : 0);
  const annual = Array.from({ length: 5 }, (_, k) => {
    const revenue = revenueTTM * Math.pow(1 + g, -k) * (0.96 + rng.next() * 0.08);
    const netProfit = (revenue * margin * (0.85 + rng.next() * 0.3)) / 100;
    return {
      year: `FY${String((fyEnd - k) % 100).padStart(2, '0')}`,
      revenue: round(revenue, 2),
      netProfit: round(netProfitTTM >= 0 ? netProfit : -Math.abs(netProfit), 2),
      roe: round(stock.roe + (rng.next() - 0.5) * 5, 2),
    };
  }).reverse();

  let promoter = stock.promoterHolding;
  let fii = stock.fiiHolding;
  let dii = stock.diiHolding;
  const shareholding: ShareholdingPoint[] = labels.slice(0, 6).map(period => {
    const point = {
      period,
      promoter: round(promoter, 2),
      fii: round(fii, 2),
      dii: round(dii, 2),
      public: round(100 - promoter - fii - dii, 2),
    };
    // Walk backwards in time with small, realistic drifts.
    promoter = Math.min(
      99,
      Math.max(0, promoter + (rng.next() - 0.55) * 0.8 * (promoter > 0 ? 1 : 0)),
    );
    fii = Math.max(0, fii + (rng.next() - 0.5) * 1.6);
    dii = Math.max(0, dii + (rng.next() - 0.45) * 1.1);
    return point;
  });

  const about =
    `${stock.name} is a ${stock.marketCapCategory.toLowerCase()} company in ${stock.industry.toLowerCase()}, ` +
    `part of the ${stock.sector} sector, with its primary listing on the ${stock.exchange}. ` +
    `Figures on EquityPulse are simulated for demonstration and do not describe the real company.`;

  return {
    symbol: stock.symbol,
    revenueTTM: round(revenueTTM, 2),
    netProfitTTM: round(netProfitTTM, 2),
    ebitdaTTM: round(ebitdaTTM, 2),
    totalDebt: round(totalDebt, 2),
    cash: round(cash, 2),
    enterpriseValue: round(stock.marketCap + totalDebt - cash, 2),
    quarterly,
    annual,
    shareholding,
    about,
  };
}
