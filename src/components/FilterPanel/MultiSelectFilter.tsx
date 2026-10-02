'use client';

import { memo, useMemo, useState } from 'react';
import type { FilterDefinition, FilterValue } from '@/types/filters';
import { optionLabel } from '@/lib/filters/panel';
import { INDEX_MEMBERSHIP_LABELS } from '@/lib/market/indices';
import { useStockStore } from '@/stores/stockStore';
import { Checkbox, Segmented } from '@/components/ui/controls';

type MultiValue = Extract<FilterValue, { type: 'multiselect' }>;

/** Options with live counts from the universe, searchable when the list is long. */
function useOptions(def: FilterDefinition): { value: string; count: number }[] {
  const columns = useStockStore(s => s.columns);
  return useMemo(() => {
    if (!columns) return [];
    if (def.field === 'indices') {
      const masks = columns.sets.get('indices');
      return INDEX_MEMBERSHIP_LABELS.map((label, bit) => {
        let count = 0;
        if (masks) for (let i = 0; i < masks.length; i++) if (masks[i]! & (1 << bit)) count++;
        return { value: label, count };
      });
    }
    const cat = columns.categories.get(def.field);
    if (!cat) return [];
    const counts = new Array<number>(cat.dictionary.length).fill(0);
    for (let i = 0; i < cat.codes.length; i++) counts[cat.codes[i]!]!++;
    const options = cat.dictionary
      .map((value, code) => ({ value, count: counts[code]! }))
      .filter(o => o.value);
    // Fixed vocabularies keep their natural order; open ones sort by size.
    const fixed = ['exchange', 'marketCapCategory', 'macdState', 'bbZone'].includes(def.field);
    return fixed ? options : options.sort((a, b) => b.count - a.count);
  }, [columns, def.field]);
}

export const MultiSelectFilter = memo(function MultiSelectFilter({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: MultiValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
}) {
  const options = useOptions(def);
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(value?.values ?? []), [value]);
  const exclude = value?.exclude ?? false;
  const searchable = options.length > 8;
  const visible = query
    ? options.filter(o =>
        optionLabel(def, o.value).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  const update = (values: string[], nextExclude = exclude): void =>
    onChange(
      values.length
        ? { type: 'multiselect', values, exclude: nextExclude || undefined }
        : undefined,
    );

  const toggle = (option: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(option);
    else next.delete(option);
    update([...next]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {searchable ? (
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Find ${def.label.toLowerCase()}…`}
            aria-label={`Find ${def.label.toLowerCase()}`}
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        ) : (
          <span className="flex-1" />
        )}
        <Segmented
          size="xs"
          label={`${def.label}: include or exclude`}
          value={exclude ? 'exclude' : 'include'}
          options={[
            { value: 'include', label: 'Include' },
            { value: 'exclude', label: 'Exclude' },
          ]}
          onChange={mode => {
            if (selected.size) update([...selected], mode === 'exclude');
            else onChange(undefined);
          }}
        />
      </div>
      <div className="max-h-[208px] overflow-y-auto pr-1">
        {visible.map(o => (
          <Checkbox
            key={o.value}
            checked={selected.has(o.value)}
            onChange={on => toggle(o.value, on)}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate">{optionLabel(def, o.value)}</span>
              <span className="shrink-0 num text-[10.5px] text-muted">
                {o.count.toLocaleString('en-IN')}
              </span>
            </span>
          </Checkbox>
        ))}
        {!visible.length ? <p className="px-1.5 py-2 text-xs text-muted">No matches.</p> : null}
      </div>
      {selected.size ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Clear {selected.size} selected
        </button>
      ) : null}
    </div>
  );
});
