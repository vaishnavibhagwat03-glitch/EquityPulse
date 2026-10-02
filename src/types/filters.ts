/**
 * Filter expression types.
 *
 * A screen is a tree: groups combine children with AND/OR (optionally negated),
 * leaves are conditions on one field. The tree is plain JSON so it can be
 * persisted, sent to `POST /api/filters/presets`, and evaluated anywhere.
 */

export type Combinator = 'AND' | 'OR';

export type ComparisonOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
export type RangeOperator = 'between' | 'notBetween';
export type FieldCompareOperator = 'above' | 'below';
export type CategoryOperator = 'in' | 'notIn';
export type SetOperator = 'hasAny' | 'hasAll' | 'hasNone';
export type BooleanOperator = 'isTrue' | 'isFalse';
export type NullOperator = 'isNull' | 'isNotNull';
export type TextOperator = 'contains';

export type Operator =
  | ComparisonOperator
  | RangeOperator
  | FieldCompareOperator
  | CategoryOperator
  | SetOperator
  | BooleanOperator
  | NullOperator
  | TextOperator;

export type ConditionValue = number | [number, number] | string[] | string;

export interface Condition {
  kind: 'condition';
  id: string;
  field: string;
  op: Operator;
  value?: ConditionValue;
  /** For `above` / `below`: the field compared against. */
  compareTo?: string;
  /** For `above` / `below`: compare against `compareTo × multiplier`. Default 1. */
  multiplier?: number;
  /** Disabled conditions are kept in the tree but not evaluated. */
  disabled?: boolean;
}

export interface Group {
  kind: 'group';
  id: string;
  combinator: Combinator;
  negate?: boolean;
  children: FilterNode[];
  label?: string;
}

export type FilterNode = Condition | Group;

export type FilterCategory = 'fundamentals' | 'market' | 'classification' | 'technical';

export type Unit = 'inr' | 'cr' | 'pct' | 'x' | 'shares' | 'plain';

export interface RangeControl {
  type: 'range';
  min: number;
  max: number;
  step: number;
  scale?: 'linear' | 'log';
}

export type OptionSource =
  'exchange' | 'sector' | 'industry' | 'marketCapCategory' | 'indices' | 'macdState' | 'bbZone';

export interface MultiSelectControl {
  type: 'multiselect';
  source: OptionSource;
  /** Display labels for fixed vocabularies. */
  labels?: Record<string, string>;
}

export interface SelectControl {
  type: 'select';
  options: { value: string; label: string }[];
}

export interface BooleanControl {
  type: 'boolean';
}

export interface RelationControl {
  type: 'relation';
  targets: { value: string; label: string }[];
}

export type FilterControl =
  RangeControl | MultiSelectControl | SelectControl | BooleanControl | RelationControl;

export interface FilterDefinition {
  id: string;
  label: string;
  /** Compact label for chips. */
  short?: string;
  category: FilterCategory;
  field: string;
  unit: Unit;
  control: FilterControl;
  description: string;
  keywords?: string[];
}

export type RangeBoundOp = 'gt' | 'gte' | 'lt' | 'lte';

export type FilterValue =
  | { type: 'range'; min?: number; max?: number; minOp?: 'gt' | 'gte'; maxOp?: 'lt' | 'lte' }
  | { type: 'multiselect'; values: string[]; exclude?: boolean }
  | { type: 'select'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'relation'; relation: 'above' | 'below'; target: string };

/** The screener's filter panel, as the user sees it. */
export interface PanelState {
  values: Record<string, FilterValue>;
  /** How conditions inside each category combine. */
  groupModes: Record<FilterCategory, Combinator>;
  /** How the categories combine with each other. */
  rootMode: Combinator;
  /** Advanced, freely nested expression from the custom builder. */
  custom: Group | null;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Plain-language criteria, shown on the preset card. */
  criteria: string[];
  panel: Pick<PanelState, 'values'> & Partial<Omit<PanelState, 'values'>>;
  builtIn: boolean;
  createdAt?: string;
}

export interface ScreenTimings {
  compileMs: number;
  evaluateMs: number;
  sortMs: number;
  totalMs: number;
}

export interface ScreenStats {
  total: number;
  matched: number;
  conditionCount: number;
  cacheHits: number;
  cacheMisses: number;
  timings: ScreenTimings;
}
