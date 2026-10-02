'use client';

import { memo } from 'react';
import type { Condition, FilterNode, Group, Operator } from '@/types/filters';
import { cn } from '@/lib/cn';
import { BOOLEAN_FIELDS, FIELD_META, NUMERIC_FIELD_LIST } from '@/lib/filters/fields';
import { conditionToText } from '@/lib/filters/panel';
import { appendChild, defaultCondition, emptyGroup, mapNode, removeNode } from '@/lib/filters/tree';
import { useFilterStore } from '@/stores/filterStore';
import { Button, IconButton } from '@/components/ui/Button';
import { NumberInput, Segmented } from '@/components/ui/controls';

/**
 * Advanced builder: freely nested AND / OR groups (with NOT) of conditions on
 * any numeric or flag field, including field-to-field comparisons such as
 * "SMA 50 above SMA 200" or "Volume above 2× Avg Volume". The result is the
 * same JSON expression the engine and the API accept.
 */

const MAX_DEPTH = 3;

const NUMERIC_OPS: { value: Operator; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'between', label: 'between' },
  { value: 'notBetween', label: 'outside' },
  { value: 'above', label: 'above field' },
  { value: 'below', label: 'below field' },
  { value: 'isNull', label: 'is empty' },
  { value: 'isNotNull', label: 'is present' },
];

const selectClass =
  'h-7 min-w-0 rounded-md border border-line bg-surface px-1.5 text-xs text-ink focus:border-accent focus:outline-none';

function FieldSelect({
  value,
  onChange,
  label,
  numericOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  numericOnly?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(selectClass, 'flex-1')}
    >
      <optgroup label="Numeric">
        {NUMERIC_FIELD_LIST.map(f => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </optgroup>
      {numericOnly ? null : (
        <optgroup label="Flags">
          {Object.entries(BOOLEAN_FIELDS).map(([key, f]) => (
            <option key={key} value={key}>
              {f.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

const ConditionRow = memo(function ConditionRow({
  node,
  onChange,
  onRemove,
}: {
  node: Condition;
  onChange: (n: Condition) => void;
  onRemove: () => void;
}) {
  const kind = FIELD_META.get(node.field)?.kind;
  const isBool = kind === 'boolean';

  const setField = (field: string): void => {
    const nextKind = FIELD_META.get(field)?.kind;
    if (nextKind === 'boolean')
      onChange({ ...node, field, op: 'isTrue', value: undefined, compareTo: undefined });
    else if (isBool) onChange({ ...node, field, op: 'gt', value: 0 });
    else onChange({ ...node, field });
  };

  const setOp = (op: Operator): void => {
    if (op === 'between' || op === 'notBetween') {
      const v = typeof node.value === 'number' ? node.value : 0;
      onChange({ ...node, op, value: [v, v * 2 || 10], compareTo: undefined });
    } else if (op === 'above' || op === 'below') {
      onChange({
        ...node,
        op,
        value: undefined,
        compareTo: node.compareTo ?? 'sma50',
        multiplier: node.multiplier ?? 1,
      });
    } else if (op === 'isNull' || op === 'isNotNull') {
      onChange({ ...node, op, value: undefined, compareTo: undefined });
    } else {
      onChange({
        ...node,
        op,
        value: typeof node.value === 'number' ? node.value : 0,
        compareTo: undefined,
      });
    }
  };

  return (
    <div className="rounded-md border border-line bg-surface p-1.5" title={conditionToText(node)}>
      <div className="flex items-center gap-1">
        <FieldSelect value={node.field} onChange={setField} label="Field" />
        {isBool ? (
          <select
            aria-label="Condition"
            value={node.op}
            onChange={e => onChange({ ...node, op: e.target.value as Operator })}
            className={selectClass}
          >
            <option value="isTrue">is true</option>
            <option value="isFalse">is false</option>
          </select>
        ) : (
          <select
            aria-label="Operator"
            value={node.op}
            onChange={e => setOp(e.target.value as Operator)}
            className={cn(selectClass, 'w-[86px]')}
          >
            {NUMERIC_OPS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <IconButton icon="x" size="xs" label="Remove condition" onClick={onRemove} />
      </div>
      {isBool || node.op === 'isNull' || node.op === 'isNotNull' ? null : (
        <div className="mt-1 flex items-center gap-1">
          {node.op === 'between' || node.op === 'notBetween' ? (
            <>
              <NumberInput
                label="From"
                value={Array.isArray(node.value) ? (node.value[0] as number) : undefined}
                onCommit={v =>
                  onChange({
                    ...node,
                    value: [v ?? 0, Array.isArray(node.value) ? (node.value[1] as number) : 0],
                  })
                }
              />
              <span className="text-[11px] text-faint">–</span>
              <NumberInput
                label="To"
                value={Array.isArray(node.value) ? (node.value[1] as number) : undefined}
                onCommit={v =>
                  onChange({
                    ...node,
                    value: [Array.isArray(node.value) ? (node.value[0] as number) : 0, v ?? 0],
                  })
                }
              />
            </>
          ) : node.op === 'above' || node.op === 'below' ? (
            <>
              <NumberInput
                label="Multiplier"
                value={node.multiplier ?? 1}
                onCommit={v => onChange({ ...node, multiplier: v && v > 0 ? v : 1 })}
                className="w-14 flex-none"
              />
              <span className="text-[11px] text-muted">×</span>
              <FieldSelect
                value={node.compareTo ?? 'sma50'}
                onChange={v => onChange({ ...node, compareTo: v })}
                label="Compared field"
                numericOnly
              />
            </>
          ) : (
            <NumberInput
              label="Value"
              value={typeof node.value === 'number' ? node.value : undefined}
              onCommit={v => onChange({ ...node, value: v ?? 0 })}
            />
          )}
        </div>
      )}
    </div>
  );
});

function GroupBlock({
  group,
  depth,
  onUpdate,
  onRemove,
}: {
  group: Group;
  depth: number;
  onUpdate: (g: Group) => void;
  onRemove?: () => void;
}) {
  const update = (id: string, fn: (n: FilterNode) => FilterNode | null): void =>
    onUpdate(mapNode(group, id, fn));
  return (
    <div className={cn('space-y-1.5', depth > 0 && 'border-l-2 border-line-strong py-0.5 pl-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Segmented
          size="xs"
          label="Combine conditions with"
          value={group.combinator}
          options={[
            { value: 'AND', label: 'ALL' },
            { value: 'OR', label: 'ANY' },
          ]}
          onChange={combinator => onUpdate({ ...group, combinator })}
        />
        <button
          type="button"
          aria-pressed={Boolean(group.negate)}
          onClick={() => onUpdate({ ...group, negate: !group.negate })}
          className={cn(
            'h-5 rounded-[4px] border px-1.5 text-[10.5px] font-medium tracking-[0.04em]',
            group.negate
              ? 'border-transparent bg-surface-inverse text-ink-inverse'
              : 'border-line text-muted hover:text-ink',
          )}
          title="Negate this group (NOT)"
        >
          NOT
        </button>
        <span className="flex-1" />
        {onRemove ? (
          <IconButton icon="x" size="xs" label="Remove group" onClick={onRemove} />
        ) : null}
      </div>
      {group.children.map(child =>
        child.kind === 'condition' ? (
          <ConditionRow
            key={child.id}
            node={child}
            onChange={next => update(child.id, () => next)}
            onRemove={() => onUpdate(removeNode(group, child.id))}
          />
        ) : (
          <GroupBlock
            key={child.id}
            group={child}
            depth={depth + 1}
            onUpdate={next => update(child.id, () => next)}
            onRemove={() => onUpdate(removeNode(group, child.id))}
          />
        ),
      )}
      <div className="flex gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          icon="plus"
          onClick={() => onUpdate(appendChild(group, group.id, defaultCondition()))}
        >
          Condition
        </Button>
        {depth + 1 < MAX_DEPTH ? (
          <Button
            size="xs"
            variant="ghost"
            icon="branch"
            onClick={() =>
              onUpdate(
                appendChild(group, group.id, {
                  ...emptyGroup('OR'),
                  children: [defaultCondition()],
                }),
              )
            }
          >
            Group
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CustomBuilder() {
  const custom = useFilterStore(s => s.panel.custom);
  const setCustom = useFilterStore(s => s.setCustom);

  if (!custom) {
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] leading-[17px] text-muted">
          Nest conditions in AND / OR groups, negate a group, or compare two fields — e.g. SMA 50
          above SMA 200.
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={() => setCustom({ ...emptyGroup('AND'), children: [defaultCondition()] })}
        >
          Build custom screen
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <GroupBlock group={custom} depth={0} onUpdate={setCustom} />
      <button
        type="button"
        onClick={() => setCustom(null)}
        className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Remove custom screen
      </button>
    </div>
  );
}
