'use client';

import { useState } from 'react';
import type { Fundamentals, Stock } from '@/types/market';
import { cn } from '@/lib/cn';
import { BB_ZONE_LABELS, MACD_LABELS } from '@/lib/filters/definitions';
import {
  DASH,
  formatCrore,
  formatInteger,
  formatNumber,
  formatPercent,
  formatPrice,
} from '@/lib/format';
import { useLiveStock } from '@/hooks/useLiveStock';
import { ChangeText, Label } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/Tabs';
import { MetricGrid } from './MetricGrid';

type TabId = 'overview' | 'financials' | 'shareholding' | 'technicals';

/** Progressive disclosure: the full record, one topic at a time. */
export function FundamentalsTabs({
  initial,
  fundamentals,
}: {
  initial: Stock;
  fundamentals: Fundamentals;
}) {
  const stock = useLiveStock(initial.symbol, initial) ?? initial;
  const [tab, setTab] = useState<TabId>('overview');
  return (
    <Tabs
      label="Company data"
      value={tab}
      onChange={setTab}
      items={[
        {
          id: 'overview',
          label: 'Overview',
          content: <Overview stock={stock} fundamentals={fundamentals} />,
        },
        {
          id: 'financials',
          label: 'Financials',
          content: <Financials fundamentals={fundamentals} />,
        },
        {
          id: 'shareholding',
          label: 'Shareholding',
          content: <Shareholding fundamentals={fundamentals} stock={stock} />,
        },
        { id: 'technicals', label: 'Technicals', content: <Technicals stock={stock} /> },
      ]}
    />
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('pt-5', className)}>
      <Label as="h2">{title}</Label>
      <div className="mt-1">{children}</div>
    </section>
  );
}

const pct = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined ? DASH : formatPercent(v, { decimals: d });
const num = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? DASH : formatNumber(v, d);

function Overview({ stock, fundamentals }: { stock: Stock; fundamentals: Fundamentals }) {
  return (
    <div className="grid gap-x-10 lg:grid-cols-2">
      <Section title="Valuation">
        <MetricGrid
          columns={1}
          metrics={[
            {
              label: 'P/E (TTM)',
              value: stock.pe === null ? 'n/m · loss-making' : num(stock.pe, 1),
            },
            { label: 'P/B', value: num(stock.pb) },
            { label: 'PEG', value: num(stock.pegRatio) },
            { label: 'EV / EBITDA', value: num(stock.evToEbitda, 1) },
            { label: 'Earnings yield', value: stock.pe ? pct(100 / stock.pe) : DASH },
            { label: 'Dividend yield', value: pct(stock.dividendYield, 2) },
          ]}
        />
      </Section>
      <Section title="Profitability">
        <MetricGrid
          columns={1}
          metrics={[
            { label: 'ROE', value: pct(stock.roe) },
            { label: 'ROCE', value: pct(stock.roce) },
            {
              label: 'Operating margin',
              value: stock.operatingMargin === null ? 'n/a · lender' : pct(stock.operatingMargin),
            },
            { label: 'Net margin', value: pct(stock.netMargin) },
            { label: 'Revenue (TTM)', value: formatCrore(fundamentals.revenueTTM) },
            { label: 'Net profit (TTM)', value: formatCrore(fundamentals.netProfitTTM) },
          ]}
        />
      </Section>
      <Section title="Growth & returns">
        <MetricGrid
          columns={1}
          metrics={[
            {
              label: 'Revenue growth (YoY)',
              value: <ChangeText value={stock.revenueGrowth} decimals={1} />,
            },
            {
              label: 'Profit growth (YoY)',
              value: <ChangeText value={stock.profitGrowth} decimals={1} />,
            },
            { label: 'Return 1M', value: <ChangeText value={stock.return1M} decimals={1} /> },
            { label: 'Return 3M', value: <ChangeText value={stock.return3M} decimals={1} /> },
            { label: 'Return 6M', value: <ChangeText value={stock.return6M} decimals={1} /> },
            { label: 'Return 1Y', value: <ChangeText value={stock.return1Y} decimals={1} /> },
          ]}
        />
      </Section>
      <Section title="Balance sheet & per share">
        <MetricGrid
          columns={1}
          metrics={[
            {
              label: 'Debt / equity',
              value: stock.debtToEquity === null ? 'n/a · deposit funded' : num(stock.debtToEquity),
            },
            { label: 'Current ratio', value: num(stock.currentRatio) },
            {
              label: 'Interest coverage',
              value: stock.interestCoverage === null ? DASH : `${num(stock.interestCoverage, 1)}×`,
            },
            { label: 'EPS (TTM)', value: `₹${formatPrice(stock.eps)}` },
            { label: 'Book value / share', value: `₹${formatPrice(stock.bookValue)}` },
            { label: 'Dividend / share', value: `₹${formatPrice(stock.dividendPerShare)}` },
            {
              label: 'Shares outstanding',
              value: `${formatNumber(stock.sharesOutstanding, 2)} Cr`,
            },
            { label: 'Face value', value: `₹${stock.faceValue}` },
          ]}
        />
      </Section>
      <p className="col-span-full pt-5 text-[11.5px] leading-5 text-muted">{fundamentals.about}</p>
    </div>
  );
}

function Financials({ fundamentals }: { fundamentals: Fundamentals }) {
  const q = fundamentals.quarterly;
  const peak = Math.max(1, ...q.map(r => Math.abs(r.revenue)));
  return (
    <div className="space-y-6 pt-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <caption className="pb-2 text-left label-caps">Quarterly results · ₹ crore</caption>
          <thead>
            <tr className="border-b border-line text-[10.5px] tracking-[0.07em] text-muted uppercase">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Quarter
              </th>
              <th scope="col" className="w-[38%] px-3 py-2 text-left font-medium">
                Revenue
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Op. profit
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Net profit
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                EPS ₹
              </th>
            </tr>
          </thead>
          <tbody>
            {q.map(r => (
              <tr key={r.period} className="border-b border-line-subtle">
                <th scope="row" className="py-2 pr-3 text-left num font-normal text-ink-2">
                  {r.period}
                </th>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-1.5 rounded-r-[2px] bg-ink-2/70"
                      style={{ width: `${(Math.abs(r.revenue) / peak) * 60}%` }}
                      aria-hidden
                    />
                    <span className="num text-ink">{formatInteger(r.revenue)}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right num text-ink-2">
                  {formatInteger(r.operatingProfit)}
                </td>
                <td
                  className={cn('px-3 py-2 text-right num', r.netProfit < 0 ? 'down' : 'text-ink')}
                >
                  {formatInteger(r.netProfit)}
                </td>
                <td className="py-2 pl-3 text-right num text-ink-2">{formatNumber(r.eps, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
          <caption className="pb-2 text-left label-caps">Annual · ₹ crore</caption>
          <thead>
            <tr className="border-b border-line text-[10.5px] tracking-[0.07em] text-muted uppercase">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Year
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Revenue
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Net profit
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                ROE
              </th>
            </tr>
          </thead>
          <tbody>
            {fundamentals.annual.map(r => (
              <tr key={r.year} className="border-b border-line-subtle">
                <th scope="row" className="py-2 pr-3 text-left num font-normal text-ink-2">
                  {r.year}
                </th>
                <td className="px-3 py-2 text-right num text-ink">{formatInteger(r.revenue)}</td>
                <td
                  className={cn('px-3 py-2 text-right num', r.netProfit < 0 ? 'down' : 'text-ink')}
                >
                  {formatInteger(r.netProfit)}
                </td>
                <td className="py-2 pl-3 text-right num text-ink-2">{pct(r.roe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MetricGrid
        columns={3}
        metrics={[
          { label: 'EBITDA (TTM)', value: formatCrore(fundamentals.ebitdaTTM) },
          { label: 'Total debt', value: formatCrore(fundamentals.totalDebt) },
          { label: 'Cash', value: formatCrore(fundamentals.cash) },
          { label: 'Enterprise value', value: formatCrore(fundamentals.enterpriseValue) },
        ]}
      />
    </div>
  );
}

const HOLDERS = [
  { key: 'promoter', label: 'Promoter', color: 'var(--series-1)' },
  { key: 'fii', label: 'FII', color: 'var(--series-2)' },
  { key: 'dii', label: 'DII', color: 'var(--series-3)' },
  { key: 'public', label: 'Public', color: 'var(--series-4)' },
] as const;

function Shareholding({ fundamentals, stock }: { fundamentals: Fundamentals; stock: Stock }) {
  const latest = fundamentals.shareholding[0];
  if (!latest) return null;
  return (
    <div className="space-y-6 pt-5">
      <div>
        <Label as="h2">Ownership · {latest.period}</Label>
        <div
          className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-[3px]"
          role="img"
          aria-label={HOLDERS.map(
            h => `${h.label} ${formatPercent(latest[h.key], { decimals: 1 })}`,
          ).join(', ')}
        >
          {HOLDERS.map(h =>
            latest[h.key] > 0 ? (
              <span key={h.key} style={{ width: `${latest[h.key]}%`, background: h.color }} />
            ) : null,
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {HOLDERS.map(h => (
            <li key={h.key} className="flex items-center gap-1.5 text-[12px]">
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: h.color }} />
              <span className="text-muted">{h.label}</span>
              <span className="num text-ink">{formatPercent(latest[h.key], { decimals: 1 })}</span>
            </li>
          ))}
        </ul>
        {stock.pledgedPercent > 0 ? (
          <p className="mt-2 text-[11.5px] text-warning">
            {formatPercent(stock.pledgedPercent, { decimals: 1 })} of promoter shares are pledged.
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
          <caption className="pb-2 text-left label-caps">Trend · % of equity</caption>
          <thead>
            <tr className="border-b border-line text-[10.5px] tracking-[0.07em] text-muted uppercase">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Quarter
              </th>
              {HOLDERS.map(h => (
                <th key={h.key} scope="col" className="px-3 py-2 text-right font-medium">
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fundamentals.shareholding.map(row => (
              <tr key={row.period} className="border-b border-line-subtle">
                <th scope="row" className="py-2 pr-3 text-left num font-normal text-ink-2">
                  {row.period}
                </th>
                {HOLDERS.map(h => (
                  <td key={h.key} className="px-3 py-2 text-right num text-ink">
                    {formatNumber(row[h.key], 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Technicals({ stock }: { stock: Stock }) {
  const rsiZone = stock.rsi14 >= 70 ? 'overbought' : stock.rsi14 <= 30 ? 'oversold' : 'neutral';
  return (
    <div className="grid gap-x-10 lg:grid-cols-2">
      <Section title="Momentum">
        <MetricGrid
          columns={1}
          metrics={[
            { label: 'RSI (14)', value: `${formatNumber(stock.rsi14, 1)} · ${rsiZone}` },
            { label: 'MACD (12, 26, 9)', value: MACD_LABELS[stock.macdState] ?? DASH },
            { label: 'MACD line', value: num(stock.macd, 2) },
            { label: 'Signal line', value: num(stock.macdSignal, 2) },
            {
              label: 'Histogram',
              value: <ChangeText value={stock.macdHistogram} percent={false} />,
            },
          ]}
        />
      </Section>
      <Section title="Trend">
        <MetricGrid
          columns={1}
          metrics={[
            {
              label: 'SMA 20',
              value: <MaValue value={stock.sma20} distance={stock.priceVsSma20} />,
            },
            {
              label: 'SMA 50',
              value: <MaValue value={stock.sma50} distance={stock.priceVsSma50} />,
            },
            {
              label: 'SMA 200',
              value: <MaValue value={stock.sma200} distance={stock.priceVsSma200} />,
            },
            {
              label: 'EMA 12 / 26',
              value: `${formatPrice(stock.ema12)} / ${formatPrice(stock.ema26)}`,
            },
            {
              label: 'SMA 50 vs 200',
              value: stock.trendState === 'GOLDEN' ? 'Golden-cross regime' : 'Death-cross regime',
            },
          ]}
        />
      </Section>
      <Section title="Volatility">
        <MetricGrid
          columns={1}
          metrics={[
            {
              label: 'Bollinger (20, 2)',
              value: `${formatPrice(stock.bbLower)} – ${formatPrice(stock.bbUpper)}`,
            },
            {
              label: '%B',
              value: `${formatNumber(stock.bbPercentB, 2)} · ${BB_ZONE_LABELS[stock.bbZone]?.toLowerCase() ?? ''}`,
            },
            {
              label: 'ATR (14)',
              value: `₹${formatPrice(stock.atr14)} · ${formatPercent(stock.atrPercent)}`,
            },
            { label: 'Volatility (60D, ann.)', value: pct(stock.volatility) },
            { label: 'Beta (252D)', value: num(stock.beta) },
          ]}
        />
      </Section>
      <Section title="Participation">
        <MetricGrid
          columns={1}
          metrics={[
            { label: 'Volume vs 20D average', value: `${formatNumber(stock.relativeVolume, 2)}×` },
            { label: 'Below 52W high', value: pct(stock.pctFrom52High) },
            { label: 'Above 52W low', value: pct(stock.pctFrom52Low) },
            { label: 'Turnover today', value: formatCrore(stock.turnover) },
          ]}
        />
      </Section>
    </div>
  );
}

function MaValue({ value, distance }: { value: number; distance: number }) {
  return (
    <span className="flex items-baseline gap-2">
      <span>₹{formatPrice(value)}</span>
      <ChangeText value={distance} decimals={1} className="text-[11px]" />
    </span>
  );
}
