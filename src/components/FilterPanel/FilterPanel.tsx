'use client';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  FilterCategory,
  FilterDefinition,
  FilterValue,
  Group,
  ScreenStats,
} from '@/types/filters';
import { cn } from '@/lib/cn';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FILTER_COUNT,
  FILTER_DEFINITIONS,
} from '@/lib/filters/definitions';
import {
  countActiveFilters,
  describeValue,
  expressionToText,
  isValueActive,
} from '@/lib/filters/panel';
import { formatInteger } from '@/lib/format';
import { useFilterStore } from '@/stores/filterStore';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/controls';
import { Icon } from '@/components/ui/Icon';
import { CustomBuilder } from './CustomBuilder';
import { MultiSelectFilter } from './MultiSelectFilter';
import { RangeFilter } from './RangeFilter';

/**
 * Filter panel — a compound component:
 *
 *   <FilterPanel stats expression>
 *     <FilterPanel.Header />  <FilterPanel.Search />
 *     <FilterPanel.Group category="fundamentals" /> …  <FilterPanel.Custom />
 *     <FilterPanel.Footer />
 *   </FilterPanel>
 *
 * Every input is controlled by the filter store; panel-local UI state (which
 * rows are open, the filter search) lives in context. Groups render
 * FilterPanel.Item, which picks the control: .Range, .MultiSelect,
 * .SingleSelect, .Boolean or .Relation.
 */

interface PanelContextValue {
  query: string;
  setQuery: (q: string) => void;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  stats: ScreenStats;
  expression: Group | null;
  onCollapse?: () => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('FilterPanel.* must be used inside <FilterPanel>');
  return ctx;
}

function matchesQuery(def: FilterDefinition, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return (
    def.label.toLowerCase().includes(q) ||
    (def.short?.toLowerCase().includes(q) ?? false) ||
    def.description.toLowerCase().includes(q) ||
    (def.keywords?.some(k => k.includes(q)) ?? false)
  );
}

export function FilterPanel({
  stats,
  expression,
  onCollapse,
  children,
  className,
}: {
  stats: ScreenStats;
  expression: Group | null;
  onCollapse?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ query, setQuery, expanded, toggle, stats, expression, onCollapse }),
    [query, expanded, toggle, stats, expression, onCollapse],
  );
  return (
    <PanelContext.Provider value={value}>
      <section
        aria-label="Filters"
        className={cn('flex h-full min-h-0 flex-col bg-surface', className)}
      >
        {children}
      </section>
    </PanelContext.Provider>
  );
}

/* -------------------------------------------------------------- Header */

FilterPanel.Header = function FilterPanelHeader() {
  const { onCollapse } = usePanel();
  const panel = useFilterStore(s => s.panel);
  const setRootMode = useFilterStore(s => s.setRootMode);
  const active = countActiveFilters(panel);
  const activeGroups =
    CATEGORY_ORDER.filter(c =>
      FILTER_DEFINITIONS.some(d => d.category === c && isValueActive(panel.values[d.id])),
    ).length + (panel.custom ? 1 : 0);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <Icon name="sliders" size={14} className="text-muted" />
      <h2 className="text-[12.5px] font-semibold tracking-[0.08em] text-ink uppercase">Filters</h2>
      {active ? (
        <span className="rounded-sm bg-surface-inverse px-1.5 num text-[10.5px] leading-[18px] text-ink-inverse">
          {active}
        </span>
      ) : null}
      <span className="flex-1" />
      {activeGroups > 1 ? (
        <Segmented
          size="xs"
          label="Combine categories with"
          value={panel.rootMode}
          options={[
            { value: 'AND', label: 'ALL', title: 'A stock must pass every category' },
            { value: 'OR', label: 'ANY', title: 'A stock may pass any category' },
          ]}
          onChange={setRootMode}
        />
      ) : null}
      {onCollapse ? (
        <IconButton icon="panel-left" label="Collapse filters (F)" onClick={onCollapse} />
      ) : null}
    </div>
  );
};

/* -------------------------------------------------------------- Search */

FilterPanel.Search = function FilterPanelSearch() {
  const { query, setQuery } = usePanel();
  return (
    <div className="shrink-0 border-b border-line px-3 py-2">
      <div className="relative">
        <Icon
          name="search"
          size={13}
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Find among ${FILTER_COUNT} filters…`}
          aria-label="Find a filter"
          className="h-7 w-full rounded-md border border-line bg-bg-sunken pr-2 pl-7 text-xs text-ink placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none"
        />
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- Group */

FilterPanel.Group = function FilterPanelGroup({ category }: { category: FilterCategory }) {
  const { query } = usePanel();
  const values = useFilterStore(s => s.panel.values);
  const mode = useFilterStore(s => s.panel.groupModes[category]);
  const setGroupMode = useFilterStore(s => s.setGroupMode);
  const defs = useMemo(
    () => FILTER_DEFINITIONS.filter(d => d.category === category && matchesQuery(d, query)),
    [category, query],
  );
  const activeCount = defs.filter(d => isValueActive(values[d.id])).length;
  const [open, setOpen] = useState(category === 'fundamentals' || category === 'technical');
  const isOpen = open || Boolean(query);
  if (!defs.length) return null;
  const headingId = `filter-group-${category}`;

  return (
    <div className="border-b border-line">
      <div className="flex h-10 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={isOpen}
          aria-controls={`${headingId}-body`}
          className="flex h-full flex-1 items-center gap-2 text-left"
        >
          <Icon
            name="chevron-right"
            size={12}
            className={cn(
              'text-muted transition-transform duration-200 ease-out',
              isOpen && 'rotate-90',
            )}
          />
          <span
            id={headingId}
            className="text-[11px] font-semibold tracking-[0.09em] text-ink-2 uppercase"
          >
            {CATEGORY_LABELS[category]}
          </span>
          {activeCount ? (
            <span className="num text-[10.5px] text-muted">{activeCount} active</span>
          ) : null}
        </button>
        {activeCount > 1 ? (
          <Segmented
            size="xs"
            label={`Combine ${CATEGORY_LABELS[category]} conditions with`}
            value={mode}
            options={[
              { value: 'AND', label: 'AND' },
              { value: 'OR', label: 'OR' },
            ]}
            onChange={m => setGroupMode(category, m)}
          />
        ) : null}
      </div>
      {isOpen ? (
        <div id={`${headingId}-body`} role="group" aria-labelledby={headingId} className="pb-2">
          {defs.map(def => (
            <FilterPanel.Item key={def.id} def={def} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- Item */

FilterPanel.Item = memo(function FilterPanelItem({ def }: { def: FilterDefinition }) {
  const { expanded, toggle } = usePanel();
  const value = useFilterStore(s => s.panel.values[def.id]);
  const setValue = useFilterStore(s => s.setValue);
  const onChange = useCallback(
    (v: FilterValue | undefined) => setValue(def.id, v),
    [setValue, def.id],
  );
  const active = isValueActive(value);
  const open = expanded.has(def.id);
  const bodyId = `filter-${def.id}`;

  return (
    <div className={cn('mx-1.5 rounded-md', open && 'bg-bg-sunken')}>
      <div className="flex h-8 items-center">
        <button
          type="button"
          onClick={() => toggle(def.id)}
          aria-expanded={open}
          aria-controls={bodyId}
          title={def.description}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover"
        >
          <span
            aria-hidden
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-150',
              active ? 'bg-ink' : 'bg-line-strong',
            )}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[12.5px]',
              active ? 'font-medium text-ink' : 'text-ink-2',
            )}
          >
            {def.label}
          </span>
          <span
            className={cn(
              'max-w-[45%] shrink-0 truncate num text-[11px]',
              active ? 'text-ink-2' : 'text-faint',
            )}
          >
            {active && value ? summary(def, value) : 'Any'}
          </span>
        </button>
        {active ? (
          <IconButton
            icon="x"
            size="xs"
            label={`Clear ${def.label}`}
            className="mr-1"
            onClick={() => onChange(undefined)}
          />
        ) : null}
      </div>
      {open ? (
        <div
          id={bodyId}
          className="px-2 pt-1 pb-3"
          style={{ animation: 'ep-fade-in 160ms var(--ep-ease-out) both' }}
        >
          <p className="mb-2 text-[11px] leading-4 text-muted">{def.description}</p>
          <FilterControl def={def} value={value} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
});

function summary(def: FilterDefinition, value: FilterValue): string {
  const text = describeValue(def, value);
  const name = def.short ?? def.label;
  return text.startsWith(name) ? text.slice(name.length).replace(/^[:\s]+/, '') : text;
}

function FilterControl({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: FilterValue | undefined;
  onChange: (v: FilterValue | undefined) => void;
}) {
  switch (def.control.type) {
    case 'range':
      return (
        <FilterPanel.Range
          def={def}
          value={value?.type === 'range' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'multiselect':
      return (
        <FilterPanel.MultiSelect
          def={def}
          value={value?.type === 'multiselect' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <FilterPanel.SingleSelect
          def={def}
          value={value?.type === 'select' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <FilterPanel.Boolean
          def={def}
          value={value?.type === 'boolean' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'relation':
      return (
        <FilterPanel.Relation
          def={def}
          value={value?.type === 'relation' ? value : undefined}
          onChange={onChange}
        />
      );
  }
}

FilterPanel.Range = RangeFilter;
FilterPanel.MultiSelect = MultiSelectFilter;

FilterPanel.SingleSelect = function SingleSelect({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: Extract<FilterValue, { type: 'select' }> | undefined;
  onChange: (v: FilterValue | undefined) => void;
}) {
  if (def.control.type !== 'select') return null;
  return (
    <div role="radiogroup" aria-label={def.label} className="space-y-0.5">
      {[{ value: '', label: 'Any' }, ...def.control.options].map(o => {
        const checked = (value?.value ?? '') === o.value;
        return (
          <button
            key={o.value || 'any'}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value ? { type: 'select', value: o.value } : undefined)}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs',
              checked ? 'text-ink' : 'text-ink-2 hover:bg-surface-hover',
            )}
          >
            <span
              className={cn(
                'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                checked ? 'border-ink' : 'border-line-strong',
              )}
            >
              {checked ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

FilterPanel.Boolean = function BooleanFilter({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: Extract<FilterValue, { type: 'boolean' }> | undefined;
  onChange: (v: FilterValue | undefined) => void;
}) {
  return (
    <Segmented
      label={def.label}
      value={value === undefined ? 'any' : value.value ? 'yes' : 'no'}
      options={[
        { value: 'any', label: 'Any' },
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ]}
      onChange={v => onChange(v === 'any' ? undefined : { type: 'boolean', value: v === 'yes' })}
    />
  );
};

FilterPanel.Relation = function RelationFilter({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: Extract<FilterValue, { type: 'relation' }> | undefined;
  onChange: (v: FilterValue | undefined) => void;
}) {
  if (def.control.type !== 'relation') return null;
  const target = def.control.targets[0]!;
  return (
    <Segmented
      label={def.label}
      value={value?.relation ?? 'any'}
      options={[
        { value: 'any', label: 'Any' },
        { value: 'above', label: `Above ${target.label}` },
        { value: 'below', label: `Below ${target.label}` },
      ]}
      onChange={v =>
        onChange(v === 'any' ? undefined : { type: 'relation', relation: v, target: target.value })
      }
    />
  );
};

/* -------------------------------------------------------------- Custom */

FilterPanel.Custom = function FilterPanelCustom() {
  const { query } = usePanel();
  const hasCustom = useFilterStore(s => Boolean(s.panel.custom));
  const [open, setOpen] = useState(false);
  if (query && !'custom advanced nested group expression'.includes(query.toLowerCase()))
    return null;
  const isOpen = open || hasCustom;
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={isOpen}
        className="flex h-10 w-full items-center gap-2 px-3 text-left"
      >
        <Icon
          name="chevron-right"
          size={12}
          className={cn(
            'text-muted transition-transform duration-200 ease-out',
            isOpen && 'rotate-90',
          )}
        />
        <span className="text-[11px] font-semibold tracking-[0.09em] text-ink-2 uppercase">
          Custom
        </span>
        <span className="text-[10.5px] text-muted">nested AND / OR</span>
      </button>
      {isOpen ? (
        <div className="px-3 pb-3">
          <CustomBuilder />
        </div>
      ) : null}
    </div>
  );
};

/* -------------------------------------------------------------- Footer */

FilterPanel.Footer = function FilterPanelFooter() {
  const { stats, expression } = usePanel();
  const clearAll = useFilterStore(s => s.clearAll);
  const active = useFilterStore(s => countActiveFilters(s.panel));
  const [showExpr, setShowExpr] = useState(false);
  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2" aria-live="polite">
        <p className="label-caps text-ink-2">
          Showing <span className="num text-[11px] text-ink">{formatInteger(stats.matched)}</span>{' '}
          of <span className="num text-[11px]">{formatInteger(stats.total)}</span> stocks
        </p>
        <span className="num text-[10.5px] text-muted" title="Screen evaluation + sort, measured">
          {stats.timings.totalMs.toFixed(2)} ms
        </span>
      </div>
      {showExpr ? (
        <p className="mt-2 max-h-24 overflow-y-auto rounded-md bg-bg-sunken p-2 num text-[10.5px] leading-4 text-ink-2">
          {expressionToText(expression)}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          disabled={!active}
          onClick={clearAll}
        >
          CLEAR ALL FILTERS
        </Button>
        <IconButton
          icon="branch"
          label={showExpr ? 'Hide compiled expression' : 'Show compiled expression'}
          active={showExpr}
          onClick={() => setShowExpr(s => !s)}
        />
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- Rail */

/** Collapsed state: a slim rail that keeps the active count visible. */
export function FilterRail({ onExpand }: { onExpand: () => void }) {
  const active = useFilterStore(s => countActiveFilters(s.panel));
  const clearAll = useFilterStore(s => s.clearAll);
  return (
    <div className="flex h-full w-12 flex-col items-center gap-2 border-r border-line bg-surface py-2">
      <IconButton icon="panel-left" label="Expand filters (F)" onClick={onExpand} />
      <button
        type="button"
        onClick={onExpand}
        aria-label={`${active} active filters. Expand filters`}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-active hover:text-ink"
      >
        <Icon name="sliders" size={15} />
        {active ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-surface-inverse px-1 num text-[9.5px] leading-4 text-ink-inverse">
            {active}
          </span>
        ) : null}
      </button>
      {active ? <IconButton icon="x" label="Clear all filters" onClick={clearAll} /> : null}
    </div>
  );
}
