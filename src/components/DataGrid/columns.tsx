'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Stock } from '@/types/market';
import { BB_ZONE_LABELS } from '@/lib/filters/definitions';
import { formatCompact, formatNumber } from '@/lib/format';
import {
  ChangeAbsCell,
  ChangeCell,
  DayRangeCell,
  MacdCell,
  MarketCapCell,
  MovingAverageCell,
  NumberCell,
  PeCell,
  PriceCell,
  RsiCell,
  SignedPercentCell,
  SparkCell,
  SymbolCell,
  TextCell,
  VolumeCell,
  Week52Cell,
} from './cells';

/**
 * Grid column catalogue. The column model (sizing, visibility, pinning) lives
 * in TanStack Table; sorting is done by the filter engine (manualSorting), so
 * each column names the engine field it sorts by.
 */

export type ColumnGroup = 'Price' | 'Fundamentals' | 'Technical' | 'Classification';

export interface GridColumnMeta {
  align: 'left' | 'right';
  /** Engine field used when the header is clicked; absent = not sortable. */
  sortField?: string;
  group: ColumnGroup;
  /** Shown on phones. */
  mobile?: boolean;
  description?: string;
  /** Visible in the default layout. */
  default?: boolean;
  /**
   * Renders the cell straight from the stock. The grid calls this for the
   * rows in view only; TanStack never builds a row model (see DataGrid).
   */
  render?: (stock: Stock) => React.ReactNode;
}

declare module '@tanstack/react-table' {
  // Module augmentation must be an interface with the library's own type parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData, TValue> extends GridColumnMeta {}
}

type Col = ColumnDef<Stock>;

const col = (
  id: string,
  header: string,
  size: number,
  meta: GridColumnMeta,
  cell: (stock: Stock) => React.ReactNode,
): Col => ({
  id,
  header,
  size,
  minSize: Math.min(size, 56),
  accessorFn: row => row[id as keyof Stock],
  cell: info => cell(info.row.original),
  meta: { ...meta, render: cell },
  enableSorting: Boolean(meta.sortField),
});

export const COLUMNS: Col[] = [
  col(
    'symbol',
    'Symbol',
    236,
    {
      align: 'left',
      sortField: 'symbol',
      group: 'Price',
      mobile: true,
      default: true,
      description: 'Ticker and company name',
    },
    s => <SymbolCell stock={s} />,
  ),
  col(
    'trend',
    '1M',
    76,
    {
      align: 'left',
      sortField: 'return1M',
      group: 'Price',
      default: true,
      description: 'One-month closing trend',
    },
    s => <SparkCell stock={s} />,
  ),
  col(
    'price',
    'LTP',
    96,
    {
      align: 'right',
      sortField: 'price',
      group: 'Price',
      mobile: true,
      default: true,
      description: 'Last traded price (₹), live',
    },
    s => <PriceCell stock={s} />,
  ),
  col(
    'changePercent',
    'Change',
    86,
    {
      align: 'right',
      sortField: 'changePercent',
      group: 'Price',
      mobile: true,
      default: true,
      description: 'Change from previous close, live',
    },
    s => <ChangeCell stock={s} />,
  ),
  col(
    'change',
    'Chg ₹',
    80,
    {
      align: 'right',
      sortField: 'change',
      group: 'Price',
      description: 'Absolute change (₹), live',
    },
    s => <ChangeAbsCell stock={s} />,
  ),
  col(
    'volume',
    'Volume',
    92,
    {
      align: 'right',
      sortField: 'volume',
      group: 'Price',
      default: true,
      description: 'Shares traded today, live (L = lakh, Cr = crore)',
    },
    s => <VolumeCell stock={s} />,
  ),
  col(
    'marketCap',
    'Mkt Cap ₹Cr',
    128,
    {
      align: 'right',
      sortField: 'marketCap',
      group: 'Fundamentals',
      default: true,
      description: 'Market capitalisation at the live price, ₹ crore',
    },
    s => <MarketCapCell stock={s} />,
  ),
  col(
    'pe',
    'P/E',
    64,
    {
      align: 'right',
      sortField: 'pe',
      group: 'Fundamentals',
      default: true,
      description: 'Price / trailing EPS at the live price',
    },
    s => <PeCell stock={s} />,
  ),
  col(
    'roe',
    'ROE',
    64,
    {
      align: 'right',
      sortField: 'roe',
      group: 'Fundamentals',
      default: true,
      description: 'Return on equity, %',
    },
    s => <NumberCell value={s.roe} decimals={1} />,
  ),
  col(
    'debtToEquity',
    'D/E',
    60,
    {
      align: 'right',
      sortField: 'debtToEquity',
      group: 'Fundamentals',
      default: true,
      description: 'Debt / equity (n/a for banks & insurers)',
    },
    s => <NumberCell value={s.debtToEquity} />,
  ),
  col(
    'rsi14',
    'RSI',
    86,
    {
      align: 'right',
      sortField: 'rsi14',
      group: 'Technical',
      default: true,
      description: 'Wilder RSI (14); 30/70 marked',
    },
    s => <RsiCell stock={s} />,
  ),
  col(
    'sma50',
    'SMA 50',
    98,
    {
      align: 'right',
      sortField: 'sma50',
      group: 'Technical',
      default: true,
      description: '50-session simple moving average; arrow = price above/below',
    },
    s => <MovingAverageCell stock={s} field="sma50" />,
  ),
  col(
    'sma200',
    'SMA 200',
    98,
    {
      align: 'right',
      sortField: 'sma200',
      group: 'Technical',
      default: true,
      description: '200-session simple moving average; arrow = price above/below',
    },
    s => <MovingAverageCell stock={s} field="sma200" />,
  ),
  // Available from the column picker.
  col(
    'sector',
    'Sector',
    170,
    { align: 'left', sortField: 'sector', group: 'Classification' },
    s => <TextCell value={s.sector} />,
  ),
  col(
    'industry',
    'Industry',
    170,
    { align: 'left', sortField: 'industry', group: 'Classification' },
    s => <TextCell value={s.industry} muted />,
  ),
  col(
    'exchange',
    'Exch',
    56,
    { align: 'left', sortField: 'exchange', group: 'Classification' },
    s => <TextCell value={s.exchange} muted />,
  ),
  col(
    'marketCapCategory',
    'Class',
    86,
    { align: 'left', sortField: 'marketCapCategory', group: 'Classification' },
    s => <TextCell value={s.marketCapCategory} muted />,
  ),
  col(
    'dayRange',
    'Day Range',
    104,
    { align: 'left', group: 'Price', description: 'Live price within the day’s range' },
    s => <DayRangeCell stock={s} />,
  ),
  col(
    'week52',
    '52W Range',
    104,
    {
      align: 'left',
      sortField: 'pctFrom52High',
      group: 'Price',
      description: 'Live price within the 52-week range',
    },
    s => <Week52Cell stock={s} />,
  ),
  col('return1M', '1M %', 72, { align: 'right', sortField: 'return1M', group: 'Price' }, s => (
    <SignedPercentCell value={s.return1M} />
  )),
  col('return3M', '3M %', 72, { align: 'right', sortField: 'return3M', group: 'Price' }, s => (
    <SignedPercentCell value={s.return3M} />
  )),
  col('return1Y', '1Y %', 72, { align: 'right', sortField: 'return1Y', group: 'Price' }, s => (
    <SignedPercentCell value={s.return1Y} />
  )),
  col(
    'relativeVolume',
    'Rel Vol',
    70,
    {
      align: 'right',
      sortField: 'relativeVolume',
      group: 'Technical',
      description: 'Volume / 20-session average',
    },
    s => <NumberCell value={s.relativeVolume} suffix="×" />,
  ),
  col(
    'turnover',
    'Turnover',
    86,
    {
      align: 'right',
      sortField: 'turnover',
      group: 'Price',
      description: 'Value traded today, ₹ crore',
    },
    s => (
      <span className="num text-[12.5px] text-ink-2">
        {formatNumber(s.turnover, s.turnover >= 100 ? 0 : 2)}
      </span>
    ),
  ),
  col('pb', 'P/B', 60, { align: 'right', sortField: 'pb', group: 'Fundamentals' }, s => (
    <NumberCell value={s.pb} />
  )),
  col(
    'dividendYield',
    'Div Yld',
    70,
    { align: 'right', sortField: 'dividendYield', group: 'Fundamentals' },
    s => <NumberCell value={s.dividendYield} suffix="%" />,
  ),
  col('roce', 'ROCE', 64, { align: 'right', sortField: 'roce', group: 'Fundamentals' }, s => (
    <NumberCell value={s.roce} decimals={1} />
  )),
  col('eps', 'EPS', 76, { align: 'right', sortField: 'eps', group: 'Fundamentals' }, s => (
    <NumberCell value={s.eps} />
  )),
  col(
    'revenueGrowth',
    'Rev Gr',
    70,
    { align: 'right', sortField: 'revenueGrowth', group: 'Fundamentals' },
    s => <SignedPercentCell value={s.revenueGrowth} />,
  ),
  col(
    'profitGrowth',
    'Prof Gr',
    72,
    { align: 'right', sortField: 'profitGrowth', group: 'Fundamentals' },
    s => <SignedPercentCell value={s.profitGrowth} />,
  ),
  col(
    'promoterHolding',
    'Promoter',
    76,
    { align: 'right', sortField: 'promoterHolding', group: 'Fundamentals' },
    s => <NumberCell value={s.promoterHolding} decimals={1} suffix="%" />,
  ),
  col('beta', 'Beta', 60, { align: 'right', sortField: 'beta', group: 'Technical' }, s => (
    <NumberCell value={s.beta} />
  )),
  col(
    'volatility',
    'Vol 60D',
    70,
    { align: 'right', sortField: 'volatility', group: 'Technical' },
    s => <NumberCell value={s.volatility} decimals={1} suffix="%" />,
  ),
  col(
    'macdState',
    'MACD',
    120,
    { align: 'left', sortField: 'macdState', group: 'Technical' },
    s => <MacdCell stock={s} />,
  ),
  col(
    'bbPercentB',
    '%B',
    64,
    {
      align: 'right',
      sortField: 'bbPercentB',
      group: 'Technical',
      description: BB_ZONE_LABELS.UPPER_HALF
        ? 'Bollinger %B (0 = lower band, 1 = upper band)'
        : undefined,
    },
    s => <NumberCell value={s.bbPercentB} />,
  ),
  col('avgVolume', 'Avg Vol', 86, { align: 'right', sortField: 'avgVolume', group: 'Price' }, s => (
    <span className="num text-[12.5px] text-ink-2">{formatCompact(s.avgVolume, 2)}</span>
  )),
];

export const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  COLUMNS.map(c => [c.id!, Boolean(c.meta?.default)]),
);

export const COLUMN_BY_ID = new Map(COLUMNS.map(c => [c.id!, c]));
