import type { PanelState, Preset } from '@/types/filters';
import { EMPTY_PANEL } from './panel';

/**
 * Built-in screens. Presets populate the filter panel itself (rather than a
 * hidden query), so every criterion stays visible and editable after applying.
 * Strict bounds (`>`/`<`) match the definitions exactly.
 */
export const BUILT_IN_PRESETS: readonly Preset[] = [
  {
    id: 'value',
    name: 'Value Stocks',
    description: 'Cheap on earnings, efficient with capital, lightly geared and paying out.',
    criteria: ['P/E < 15', 'ROE > 15%', 'Debt / Equity < 0.5', 'Dividend Yield > 2%'],
    builtIn: true,
    panel: {
      values: {
        pe: { type: 'range', max: 15, maxOp: 'lt' },
        roe: { type: 'range', min: 15, minOp: 'gt' },
        debtToEquity: { type: 'range', max: 0.5, maxOp: 'lt' },
        dividendYield: { type: 'range', min: 2, minOp: 'gt' },
      },
    },
  },
  {
    id: 'growth-momentum',
    name: 'Growth Momentum',
    description: 'Compounding revenue and profit, trending up without being stretched.',
    criteria: ['Revenue Growth > 20%', 'Profit Growth > 20%', 'RSI 40–70', 'Price above SMA 50'],
    builtIn: true,
    panel: {
      values: {
        revenueGrowth: { type: 'range', min: 20, minOp: 'gt' },
        profitGrowth: { type: 'range', min: 20, minOp: 'gt' },
        rsi14: { type: 'range', min: 40, max: 70 },
        priceSma50: { type: 'relation', relation: 'above', target: 'sma50' },
      },
    },
  },
  {
    id: 'large-cap-quality',
    name: 'Large Cap Quality',
    description: 'Large, capital-efficient businesses with committed promoters.',
    criteria: ['Market Cap > ₹20,000 Cr', 'ROCE > 15%', 'Promoter Holding > 50%'],
    builtIn: true,
    panel: {
      values: {
        marketCap: { type: 'range', min: 20_000, minOp: 'gt' },
        roce: { type: 'range', min: 15, minOp: 'gt' },
        promoterHolding: { type: 'range', min: 50, minOp: 'gt' },
      },
    },
  },
  {
    id: 'technical-breakout',
    name: 'Technical Breakout',
    description:
      'Above the long-term trend, momentum building, volume confirming, pressing the upper band.',
    criteria: ['Price above SMA 200', 'RSI 50–70', 'Volume > 2× average', 'Bollinger %B ≥ 0.8'],
    builtIn: true,
    panel: {
      values: {
        priceSma200: { type: 'relation', relation: 'above', target: 'sma200' },
        rsi14: { type: 'range', min: 50, max: 70 },
        relativeVolume: { type: 'range', min: 2, minOp: 'gt' },
        bbPercentB: { type: 'range', min: 0.8 },
      },
    },
  },
  {
    id: 'oversold-quality',
    name: 'Oversold Quality',
    description: 'Profitable, efficient companies that have been sold down hard.',
    criteria: ['RSI ≤ 35', 'ROE ≥ 15%', 'Debt / Equity ≤ 1', 'Profitable'],
    builtIn: true,
    panel: {
      values: {
        rsi14: { type: 'range', max: 35 },
        roe: { type: 'range', min: 15 },
        debtToEquity: { type: 'range', max: 1 },
        isProfitable: { type: 'boolean', value: true },
      },
    },
  },
  {
    id: 'new-highs',
    name: '52-Week Highs',
    description: 'Within 2% of a 52-week high on above-average volume, excluding micro caps.',
    criteria: ['Below 52W High ≤ 2%', 'Volume ≥ 1.5× average', 'Large, Mid or Small Cap'],
    builtIn: true,
    panel: {
      values: {
        pctFrom52High: { type: 'range', max: 2 },
        relativeVolume: { type: 'range', min: 1.5 },
        marketCapCategory: { type: 'multiselect', values: ['Large Cap', 'Mid Cap', 'Small Cap'] },
      },
    },
  },
];

export function panelFromPreset(preset: Preset): PanelState {
  return {
    values: structuredClone(preset.panel.values),
    groupModes: { ...EMPTY_PANEL.groupModes, ...preset.panel.groupModes },
    rootMode: preset.panel.rootMode ?? 'AND',
    custom: preset.panel.custom ? structuredClone(preset.panel.custom) : null,
  };
}

export const PRESET_BY_ID: ReadonlyMap<string, Preset> = new Map(
  BUILT_IN_PRESETS.map(p => [p.id, p]),
);
