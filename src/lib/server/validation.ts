import { z } from 'zod';
import type { FilterNode, FilterValue, Group, PanelState } from '@/types/filters';
import { validateExpression } from '@/lib/filterEngine';
import { FILTER_BY_ID } from '@/lib/filters/definitions';

/**
 * Request validation for endpoints that accept filter expressions.
 * Shape is checked with Zod; semantics (known fields, operator/value fit,
 * value type matching the filter's control) with the engine's own validator,
 * so the API and the UI enforce exactly the same rules.
 */

const MAX_DEPTH = 6;
const MAX_NODES = 120;

const operators = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'between',
  'notBetween',
  'above',
  'below',
  'in',
  'notIn',
  'hasAny',
  'hasAll',
  'hasNone',
  'isTrue',
  'isFalse',
  'isNull',
  'isNotNull',
  'contains',
] as const;

const conditionSchema = z.object({
  kind: z.literal('condition'),
  id: z.string().min(1).max(80),
  field: z.string().min(1).max(40),
  op: z.enum(operators),
  value: z
    .union([
      z.number().finite(),
      z.tuple([z.number().finite(), z.number().finite()]),
      z.array(z.string().max(80)).max(200),
      z.string().max(200),
    ])
    .optional(),
  compareTo: z.string().max(40).optional(),
  multiplier: z.number().finite().positive().max(100).optional(),
  disabled: z.boolean().optional(),
});

export const groupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    id: z.string().min(1).max(80),
    combinator: z.enum(['AND', 'OR']),
    negate: z.boolean().optional(),
    label: z.string().max(80).optional(),
    children: z.array(z.union([conditionSchema, groupSchema])).max(50),
  }),
);

export const nodeSchema: z.ZodType<FilterNode> = z.union([conditionSchema, groupSchema]);

const rangeValue = z.object({
  type: z.literal('range'),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  minOp: z.enum(['gt', 'gte']).optional(),
  maxOp: z.enum(['lt', 'lte']).optional(),
});

const filterValueSchema: z.ZodType<FilterValue> = z.discriminatedUnion('type', [
  rangeValue,
  z.object({
    type: z.literal('multiselect'),
    values: z.array(z.string().max(80)).max(200),
    exclude: z.boolean().optional(),
  }),
  z.object({ type: z.literal('select'), value: z.string().max(80) }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({
    type: z.literal('relation'),
    relation: z.enum(['above', 'below']),
    target: z.string().max(40),
  }),
]);

const combinator = z.enum(['AND', 'OR']);

export const panelSchema = z.object({
  values: z.record(z.string().max(40), filterValueSchema),
  groupModes: z
    .object({
      fundamentals: combinator,
      market: combinator,
      classification: combinator,
      technical: combinator,
    })
    .partial()
    .optional(),
  rootMode: combinator.optional(),
  custom: groupSchema.nullable().optional(),
});

export const presetInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240).optional(),
  panel: panelSchema,
});

export const screenRequestSchema = z.object({
  expression: nodeSchema.nullable().optional(),
  panel: panelSchema.optional(),
  search: z.string().max(100).optional(),
  sort: z.object({ field: z.string().max(40), direction: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

function measure(node: FilterNode, depth = 1): { depth: number; nodes: number } {
  if (node.kind === 'condition') return { depth, nodes: 1 };
  return node.children.reduce(
    (acc, child) => {
      const m = measure(child, depth + 1);
      return { depth: Math.max(acc.depth, m.depth), nodes: acc.nodes + m.nodes };
    },
    { depth, nodes: 1 },
  );
}

/** Semantic checks beyond shape: size limits, field/operator fit. */
export function expressionIssues(node: FilterNode): string[] {
  const { depth, nodes } = measure(node);
  const issues: string[] = [];
  if (depth > MAX_DEPTH)
    issues.push(`Expression nests ${depth} levels deep (maximum ${MAX_DEPTH})`);
  if (nodes > MAX_NODES) issues.push(`Expression has ${nodes} nodes (maximum ${MAX_NODES})`);
  return [...issues, ...validateExpression(node)];
}

/** Every panel entry must name a known filter and use that filter's control type. */
export function panelIssues(panel: Pick<PanelState, 'values' | 'custom'>): string[] {
  const issues: string[] = [];
  for (const [id, value] of Object.entries(panel.values)) {
    const def = FILTER_BY_ID.get(id);
    if (!def) {
      issues.push(`Unknown filter "${id}"`);
      continue;
    }
    if (def.control.type !== value.type) {
      issues.push(`Filter "${id}" expects a ${def.control.type} value, got ${value.type}`);
    }
  }
  if (panel.custom) issues.push(...expressionIssues(panel.custom));
  return issues;
}

export function zodIssues(error: z.ZodError): string[] {
  return error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`);
}
