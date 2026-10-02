import { describe, expect, it } from 'vitest';
import type { FilterValue, Group, PanelState } from '@/types/filters';
import { validateExpression } from '@/lib/filterEngine';
import {
  CATEGORY_ORDER,
  FILTER_BY_ID,
  FILTER_COUNT,
  FILTER_DEFINITIONS,
} from '@/lib/filters/definitions';
import { FIELD_META } from '@/lib/filters/fields';
import {
  compileValue,
  conditionToText,
  countActiveFilters,
  countConditions,
  describeValue,
  EMPTY_PANEL,
  expressionToText,
  formatBound,
  isValueActive,
  optionLabel,
  panelToExpression,
} from '@/lib/filters/panel';
import { BUILT_IN_PRESETS, panelFromPreset, PRESET_BY_ID } from '@/lib/filters/presets';
import {
  appendChild,
  defaultCondition,
  depthOf,
  emptyGroup,
  mapNode,
  removeNode,
} from '@/lib/filters/tree';

const def = (id: string) => FILTER_BY_ID.get(id)!;
const panel = (
  values: Record<string, FilterValue>,
  extra: Partial<PanelState> = {},
): PanelState => ({
  ...structuredClone(EMPTY_PANEL),
  values,
  ...extra,
});

describe('filter catalogue', () => {
  it('offers 30+ criteria across the four categories, each on a known field', () => {
    expect(FILTER_COUNT).toBeGreaterThanOrEqual(30);
    expect(new Set(FILTER_DEFINITIONS.map(d => d.id)).size).toBe(FILTER_COUNT);
    for (const category of CATEGORY_ORDER) {
      expect(
        FILTER_DEFINITIONS.some(d => d.category === category),
        category,
      ).toBe(true);
    }
    for (const d of FILTER_DEFINITIONS) expect(FIELD_META.has(d.field), d.id).toBe(true);
  });

  it('compiles a representative value of every filter into a valid condition', () => {
    for (const d of FILTER_DEFINITIONS) {
      const value: FilterValue =
        d.control.type === 'range'
          ? {
              type: 'range',
              min: d.control.min + d.control.step,
              max: d.control.max - d.control.step,
            }
          : d.control.type === 'multiselect'
            ? { type: 'multiselect', values: ['x'] }
            : d.control.type === 'select'
              ? { type: 'select', value: d.control.options[0]!.value }
              : d.control.type === 'boolean'
                ? { type: 'boolean', value: true }
                : { type: 'relation', relation: 'above', target: d.control.targets[0]!.value };
      const node = compileValue(d, value);
      expect(node, d.id).not.toBeNull();
      expect(validateExpression(node!), d.id).toEqual([]);
    }
  });
});

describe('panel values → conditions', () => {
  it('knows when a value constrains anything', () => {
    expect(isValueActive(undefined)).toBe(false);
    expect(isValueActive({ type: 'range' })).toBe(false);
    expect(isValueActive({ type: 'range', min: 0 })).toBe(true);
    expect(isValueActive({ type: 'multiselect', values: [] })).toBe(false);
    expect(isValueActive({ type: 'select', value: '' })).toBe(false);
    expect(isValueActive({ type: 'boolean', value: false })).toBe(true);
    expect(compileValue(def('pe'), { type: 'range' })).toBeNull();
  });

  it('compiles inclusive ranges to between and one-sided ranges to a comparison', () => {
    expect(compileValue(def('pe'), { type: 'range', min: 5, max: 15 })).toMatchObject({
      field: 'pe',
      op: 'between',
      value: [5, 15],
    });
    expect(compileValue(def('pe'), { type: 'range', max: 15, maxOp: 'lt' })).toMatchObject({
      op: 'lt',
      value: 15,
    });
    expect(compileValue(def('roe'), { type: 'range', min: 15 })).toMatchObject({
      op: 'gte',
      value: 15,
    });
  });

  it('splits a range with a strict bound into an AND of two comparisons', () => {
    const node = compileValue(def('rsi14'), { type: 'range', min: 40, max: 70, minOp: 'gt' });
    expect(node).toMatchObject({
      kind: 'group',
      combinator: 'AND',
      children: [
        { op: 'gt', value: 40 },
        { op: 'lte', value: 70 },
      ],
    });
  });

  it('compiles multi-selects to in / notIn, and index membership to set operators', () => {
    expect(compileValue(def('sector'), { type: 'multiselect', values: ['Banking'] })).toMatchObject(
      { op: 'in', value: ['Banking'] },
    );
    expect(
      compileValue(def('sector'), { type: 'multiselect', values: ['Banking'], exclude: true }),
    ).toMatchObject({ op: 'notIn' });
    expect(
      compileValue(def('indices'), { type: 'multiselect', values: ['NIFTY 50'] }),
    ).toMatchObject({ field: 'indices', op: 'hasAny' });
    expect(
      compileValue(def('indices'), { type: 'multiselect', values: ['NIFTY 50'], exclude: true }),
    ).toMatchObject({ op: 'hasNone' });
  });

  it('compiles selects, booleans and field relations', () => {
    expect(compileValue(def('trendState'), { type: 'select', value: 'GOLDEN' })).toMatchObject({
      field: 'trendState',
      op: 'in',
      value: ['GOLDEN'],
    });
    expect(compileValue(def('isProfitable'), { type: 'boolean', value: false })).toMatchObject({
      op: 'isFalse',
    });
    expect(
      compileValue(def('priceSma50'), { type: 'relation', relation: 'above', target: 'sma50' }),
    ).toMatchObject({
      field: 'price',
      op: 'above',
      compareTo: 'sma50',
    });
  });
});

describe('panel → expression', () => {
  it('returns null when nothing is set', () => {
    expect(panelToExpression(EMPTY_PANEL)).toBeNull();
    expect(panelToExpression(panel({ pe: { type: 'range' } }))).toBeNull();
  });

  it('groups conditions by category with each category’s mode, joined by the root mode', () => {
    const expr = panelToExpression(
      panel(
        {
          pe: { type: 'range', max: 15, maxOp: 'lt' },
          roe: { type: 'range', min: 15, minOp: 'gt' },
          sector: { type: 'multiselect', values: ['Banking'] },
        },
        { groupModes: { ...EMPTY_PANEL.groupModes, fundamentals: 'OR' }, rootMode: 'OR' },
      ),
    )!;
    const root = expr.children.find(c => c.id === 'root') as Group;
    expect(root.combinator).toBe('OR');
    const fundamentals = root.children.find(c => c.id === 'cat:fundamentals') as Group;
    expect(fundamentals.combinator).toBe('OR');
    expect(fundamentals.children).toHaveLength(2);
    expect(root.children.find(c => c.id === 'cat:classification')).toBeDefined();
  });

  it('ANDs search, watchlist-only and the custom builder onto the screen', () => {
    const custom: Group = {
      kind: 'group',
      id: 'custom',
      combinator: 'OR',
      children: [defaultCondition()],
    };
    const expr = panelToExpression(panel({}, { custom }), {
      search: '  bank ',
      watchlistOnly: true,
    })!;
    expect(expr.combinator).toBe('AND');
    expect(expr.children[0]).toMatchObject({ field: 'search', value: 'bank' });
    expect(expr.children[1]).toMatchObject({ field: 'watchlist', op: 'isTrue' });
    expect((expr.children[2] as Group).children[0]).toBe(custom);
    // A custom group with nothing enabled adds nothing.
    const idle: Group = {
      kind: 'group',
      id: 'idle',
      combinator: 'AND',
      children: [{ ...defaultCondition(), disabled: true }],
    };
    expect(panelToExpression(panel({}, { custom: idle }))).toBeNull();
  });

  it('counts active filters and conditions', () => {
    const p = panel({
      pe: { type: 'range', max: 15 },
      roe: { type: 'range' },
      unknownFilter: { type: 'range', min: 1 },
    });
    expect(countActiveFilters(p)).toBe(1);
    expect(countConditions(panelToExpression(p))).toBe(1);
    expect(countConditions(null)).toBe(0);
  });
});

describe('presets', () => {
  it('ships the four screens from the specification with their criteria', () => {
    for (const id of ['value', 'growth-momentum', 'large-cap-quality', 'technical-breakout']) {
      expect(PRESET_BY_ID.has(id), id).toBe(true);
    }
    const value = panelFromPreset(PRESET_BY_ID.get('value')!);
    expect(value.values).toMatchObject({
      pe: { max: 15, maxOp: 'lt' },
      roe: { min: 15, minOp: 'gt' },
      debtToEquity: { max: 0.5, maxOp: 'lt' },
      dividendYield: { min: 2, minOp: 'gt' },
    });
  });

  it('every preset compiles to a valid expression', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const expr = panelToExpression(panelFromPreset(preset));
      expect(expr, preset.id).not.toBeNull();
      expect(validateExpression(expr!), preset.id).toEqual([]);
    }
  });

  it('copies the preset, so editing the panel never mutates the built-in', () => {
    const preset = PRESET_BY_ID.get('value')!;
    const p = panelFromPreset(preset);
    (p.values.pe as { max: number }).max = 99;
    expect((preset.panel.values.pe as { max: number }).max).toBe(15);
  });
});

describe('human-readable text', () => {
  it('formats bounds by unit', () => {
    expect(formatBound('pct', 15)).toBe('15%');
    expect(formatBound('inr', 1428.3)).toBe('₹1,428.3');
    expect(formatBound('cr', 20000)).toBe('₹20,000 Cr');
    expect(formatBound('x', 2)).toBe('2×');
    expect(formatBound('shares', 1_500_000)).toBe('15.00 L');
    expect(formatBound('plain', 0.5)).toBe('0.5');
  });

  it('describes chips the way the specification writes them', () => {
    expect(describeValue(def('pe'), { type: 'range', max: 15, maxOp: 'lt' })).toBe('P/E < 15');
    expect(describeValue(def('roe'), { type: 'range', min: 15, minOp: 'gt' })).toBe('ROE > 15%');
    expect(describeValue(def('rsi14'), { type: 'range', min: 40, max: 70 })).toMatch(/40–70$/);
    expect(
      describeValue(def('rsi14'), { type: 'range', min: 40, max: 70, minOp: 'gt', maxOp: 'lt' }),
    ).toMatch(/> 40, < 70$/);
    expect(
      describeValue(def('sector'), { type: 'multiselect', values: ['Banking', 'Power', 'Realty'] }),
    ).toBe('Sector: Banking, Power +1');
    expect(
      describeValue(def('sector'), { type: 'multiselect', values: ['Banking'], exclude: true }),
    ).toBe('Sector not: Banking');
    expect(describeValue(def('isProfitable'), { type: 'boolean', value: false })).toBe(
      'Not profitable (ttm)',
    );
    expect(describeValue(def('trendState'), { type: 'select', value: 'GOLDEN' })).toBe(
      'SMA 50 above SMA 200',
    );
    expect(
      describeValue(def('priceSma50'), { type: 'relation', relation: 'above', target: 'sma50' }),
    ).toBe('Price above SMA 50');
  });

  it('labels fixed vocabularies', () => {
    expect(optionLabel(def('macdState'), 'BULLISH_CROSS')).not.toBe('BULLISH_CROSS');
    expect(optionLabel(def('sector'), 'Banking')).toBe('Banking');
    expect(optionLabel(def('trendState'), 'DEATH')).toBe('SMA 50 below SMA 200');
  });

  it('renders an expression as text with grouping and negation', () => {
    const expr: Group = {
      kind: 'group',
      id: 'r',
      combinator: 'AND',
      children: [
        { kind: 'condition', id: 'a', field: 'pe', op: 'lt', value: 15 },
        {
          kind: 'group',
          id: 'o',
          combinator: 'OR',
          negate: true,
          children: [
            { kind: 'condition', id: 'b', field: 'sector', op: 'in', value: ['Banking'] },
            {
              kind: 'condition',
              id: 'c',
              field: 'price',
              op: 'above',
              compareTo: 'sma50',
              multiplier: 2,
            },
          ],
        },
      ],
    };
    expect(expressionToText(expr)).toBe(
      'P/E < 15 AND NOT (Sector in [Banking] OR Price above 2× SMA 50)',
    );
    expect(expressionToText(null)).toBe('All securities');
    expect(
      conditionToText({ kind: 'condition', id: 'x', field: 'pe', op: 'notBetween', value: [1, 2] }),
    ).toBe('P/E outside 1–2');
    expect(conditionToText({ kind: 'condition', id: 'x', field: 'pe', op: 'isNull' })).toBe(
      'P/E is empty',
    );
    expect(
      conditionToText({
        kind: 'condition',
        id: 'x',
        field: 'search',
        op: 'contains',
        value: 'tata',
      }),
    ).toBe('matches “tata”');
  });
});

describe('expression tree edits (custom builder)', () => {
  it('appends, maps and removes nodes immutably', () => {
    const root = emptyGroup('AND');
    const inner = emptyGroup('OR');
    const leaf = defaultCondition();
    const withInner = appendChild(root, root.id, inner);
    const withLeaf = appendChild(withInner, inner.id, leaf);
    expect(root.children).toHaveLength(0);
    expect(depthOf(withLeaf, leaf.id)).toBe(2);
    expect(depthOf(withLeaf, 'missing')).toBe(-1);

    const edited = mapNode(withLeaf, leaf.id, n => ({ ...n, value: 25 }) as typeof n);
    expect(((edited.children[0] as Group).children[0] as typeof leaf).value).toBe(25);
    expect(((withLeaf.children[0] as Group).children[0] as typeof leaf).value).toBe(15);

    const removed = removeNode(withLeaf, inner.id);
    expect(removed.children).toHaveLength(0);
    // Removing the root itself leaves an empty group rather than nothing.
    expect(removeNode(withLeaf, withLeaf.id)).toMatchObject({ kind: 'group', children: [] });
  });
});
