import type {
  Combinator,
  Condition,
  FilterCategory,
  FilterDefinition,
  FilterNode,
  FilterValue,
  Group,
  PanelState,
  Unit,
} from '@/types/filters';
import { formatCompact, formatCrore, formatNumber } from '@/lib/format';
import {
  BB_ZONE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FILTER_BY_ID,
  FILTER_DEFINITIONS,
  MACD_LABELS,
} from './definitions';
import { FIELD_META } from './fields';

/**
 * Panel state → filter expression.
 *
 * The panel is what users manipulate: one value per filter, an AND/OR mode per
 * category, a root mode across categories, and an optional free-form nested
 * group from the custom builder. This module compiles that into the engine's
 * expression tree and renders the human-readable chips and expression text.
 */

export const DEFAULT_GROUP_MODES: Record<FilterCategory, Combinator> = {
  fundamentals: 'AND',
  market: 'AND',
  classification: 'AND',
  technical: 'AND',
};

export const EMPTY_PANEL: PanelState = {
  values: {},
  groupModes: { ...DEFAULT_GROUP_MODES },
  rootMode: 'AND',
  custom: null,
};

export function isValueActive(value: FilterValue | undefined): boolean {
  if (!value) return false;
  switch (value.type) {
    case 'range':
      return value.min !== undefined || value.max !== undefined;
    case 'multiselect':
      return value.values.length > 0;
    case 'select':
      return value.value !== '';
    case 'boolean':
    case 'relation':
      return true;
  }
}

/** One panel entry → a condition (or a two-condition group for strict ranges). */
export function compileValue(def: FilterDefinition, value: FilterValue): FilterNode | null {
  if (!isValueActive(value)) return null;
  const id = `f:${def.id}`;
  const c = (
    op: Condition['op'],
    v?: Condition['value'],
    extra: Partial<Condition> = {},
  ): Condition => ({
    kind: 'condition',
    id,
    field: def.field,
    op,
    value: v,
    ...extra,
  });

  switch (value.type) {
    case 'range': {
      const { min, max } = value;
      const minOp = value.minOp ?? 'gte';
      const maxOp = value.maxOp ?? 'lte';
      if (min !== undefined && max !== undefined) {
        if (minOp === 'gte' && maxOp === 'lte') return c('between', [min, max]);
        return {
          kind: 'group',
          id,
          combinator: 'AND',
          children: [c(minOp, min, { id: `${id}:min` }), c(maxOp, max, { id: `${id}:max` })],
        };
      }
      if (min !== undefined) return c(minOp, min);
      return c(maxOp, max);
    }
    case 'multiselect': {
      const isSet = FIELD_META.get(def.field)?.kind === 'set';
      if (isSet) return c(value.exclude ? 'hasNone' : 'hasAny', value.values);
      return c(value.exclude ? 'notIn' : 'in', value.values);
    }
    case 'select':
      return c('in', [value.value]);
    case 'boolean':
      return c(value.value ? 'isTrue' : 'isFalse');
    case 'relation':
      return c(value.relation, undefined, { compareTo: value.target });
  }
}

function nodeHasActiveCondition(node: FilterNode): boolean {
  if (node.kind === 'condition') return !node.disabled;
  return node.children.some(nodeHasActiveCondition);
}

export interface ExpressionExtras {
  search?: string;
  watchlistOnly?: boolean;
}

export function panelToExpression(panel: PanelState, extras: ExpressionExtras = {}): Group | null {
  const groups: FilterNode[] = [];
  for (const category of CATEGORY_ORDER) {
    const children: FilterNode[] = [];
    for (const def of FILTER_DEFINITIONS) {
      if (def.category !== category) continue;
      const value = panel.values[def.id];
      if (!value) continue;
      const node = compileValue(def, value);
      if (node) children.push(node);
    }
    if (children.length) {
      groups.push({
        kind: 'group',
        id: `cat:${category}`,
        label: CATEGORY_LABELS[category],
        combinator: panel.groupModes[category] ?? 'AND',
        children,
      });
    }
  }
  if (panel.custom && nodeHasActiveCondition(panel.custom)) groups.push(panel.custom);

  const top: FilterNode[] = [];
  const search = extras.search?.trim();
  if (search)
    top.push({ kind: 'condition', id: 'search', field: 'search', op: 'contains', value: search });
  if (extras.watchlistOnly)
    top.push({ kind: 'condition', id: 'watchlist', field: 'watchlist', op: 'isTrue' });
  if (groups.length)
    top.push({ kind: 'group', id: 'root', combinator: panel.rootMode, children: groups });
  return top.length ? { kind: 'group', id: 'screen', combinator: 'AND', children: top } : null;
}

export function countConditions(node: FilterNode | null): number {
  if (!node) return 0;
  if (node.kind === 'condition') return node.disabled ? 0 : 1;
  return node.children.reduce((n, c) => n + countConditions(c), 0);
}

export function countActiveFilters(panel: PanelState): number {
  let n = 0;
  for (const [id, value] of Object.entries(panel.values)) {
    if (FILTER_BY_ID.has(id) && isValueActive(value)) n++;
  }
  return n + countConditions(panel.custom);
}

/* ------------------------------------------------------------------------ */
/* Human-readable text                                                      */
/* ------------------------------------------------------------------------ */

export function formatBound(unit: Unit, v: number): string {
  switch (unit) {
    case 'cr':
      return formatCrore(v);
    case 'pct':
      return `${formatNumber(v, 2, 0)}%`;
    case 'inr':
      return `₹${formatNumber(v, 2, 0)}`;
    case 'shares':
      return formatCompact(v);
    case 'x':
      return `${formatNumber(v, 2, 0)}×`;
    default:
      return formatNumber(v, 2, 0);
  }
}

const OP_SYMBOL: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

export function optionLabel(def: FilterDefinition, value: string): string {
  if (def.control.type === 'multiselect') {
    const labels =
      def.control.labels ??
      (def.field === 'macdState'
        ? MACD_LABELS
        : def.field === 'bbZone'
          ? BB_ZONE_LABELS
          : undefined);
    return labels?.[value] ?? value;
  }
  if (def.control.type === 'select')
    return def.control.options.find(o => o.value === value)?.label ?? value;
  return value;
}

/** Chip text, e.g. "P/E < 15", "ROE > 15%", "Sector: Banking, IT +1". */
export function describeValue(def: FilterDefinition, value: FilterValue): string {
  const name = def.short ?? def.label;
  switch (value.type) {
    case 'range': {
      const { min, max } = value;
      const minOp = value.minOp ?? 'gte';
      const maxOp = value.maxOp ?? 'lte';
      if (min !== undefined && max !== undefined) {
        if (minOp === 'gte' && maxOp === 'lte')
          return `${name} ${formatBound(def.unit, min)}–${formatBound(def.unit, max)}`;
        return `${name} ${OP_SYMBOL[minOp]} ${formatBound(def.unit, min)}, ${OP_SYMBOL[maxOp]} ${formatBound(def.unit, max)}`;
      }
      if (min !== undefined) return `${name} ${OP_SYMBOL[minOp]} ${formatBound(def.unit, min)}`;
      if (max !== undefined) return `${name} ${OP_SYMBOL[maxOp]} ${formatBound(def.unit, max)}`;
      return name;
    }
    case 'multiselect': {
      const labels = value.values.map(v => optionLabel(def, v));
      const head = labels.slice(0, 2).join(', ');
      const more = labels.length > 2 ? ` +${labels.length - 2}` : '';
      return `${name}${value.exclude ? ' not' : ''}: ${head}${more}`;
    }
    case 'select':
      return optionLabel(def, value.value);
    case 'boolean':
      return value.value ? def.label : `Not ${def.label.toLowerCase()}`;
    case 'relation': {
      const subject = FIELD_META.get(def.field)?.label ?? def.field;
      const target = FIELD_META.get(value.target)?.label ?? value.target;
      return `${subject} ${value.relation} ${target}`;
    }
  }
}

/** Plain-text rendering of an expression, shown as the compiled screen. */
export function expressionToText(node: FilterNode | null, depth = 0): string {
  if (!node) return 'All securities';
  if (node.kind === 'condition') return conditionToText(node);
  const parts = node.children
    .filter(nodeHasActiveCondition)
    .map(child => expressionToText(child, depth + 1));
  if (!parts.length) return 'All securities';
  const joined = parts.length === 1 ? parts[0]! : parts.join(` ${node.combinator} `);
  const wrapped = depth > 0 && parts.length > 1 ? `(${joined})` : joined;
  return node.negate ? `NOT ${parts.length > 1 ? wrapped : `(${joined})`}` : wrapped;
}

export function conditionToText(c: Condition): string {
  const meta = FIELD_META.get(c.field);
  const label = meta?.label ?? c.field;
  const unit = meta?.unit ?? 'plain';
  switch (c.op) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'eq':
    case 'neq':
      return `${label} ${OP_SYMBOL[c.op]} ${formatBound(unit, c.value as number)}`;
    case 'between': {
      const [a, b] = c.value as [number, number];
      return `${label} ${formatBound(unit, a)}–${formatBound(unit, b)}`;
    }
    case 'notBetween': {
      const [a, b] = c.value as [number, number];
      return `${label} outside ${formatBound(unit, a)}–${formatBound(unit, b)}`;
    }
    case 'above':
    case 'below': {
      const target = FIELD_META.get(c.compareTo ?? '')?.label ?? c.compareTo;
      const m = c.multiplier && c.multiplier !== 1 ? `${formatNumber(c.multiplier, 2, 0)}× ` : '';
      return `${label} ${c.op} ${m}${target}`;
    }
    case 'in':
    case 'hasAny':
      return `${label} in [${(c.value as string[]).join(', ')}]`;
    case 'notIn':
    case 'hasNone':
      return `${label} not in [${(c.value as string[]).join(', ')}]`;
    case 'hasAll':
      return `${label} in all of [${(c.value as string[]).join(', ')}]`;
    case 'isTrue':
      return label;
    case 'isFalse':
      return `NOT ${label}`;
    case 'isNull':
      return `${label} is empty`;
    case 'isNotNull':
      return `${label} is present`;
    case 'contains':
      return `matches “${String(c.value)}”`;
  }
}
