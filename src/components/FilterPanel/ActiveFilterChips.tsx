'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { FILTER_BY_ID } from '@/lib/filters/definitions';
import { countConditions, describeValue, isValueActive } from '@/lib/filters/panel';
import { useFilterStore } from '@/stores/filterStore';
import { Icon } from '@/components/ui/Icon';

/** Applied filters as removable chips, in panel order. */
export function ActiveFilterChips({ className }: { className?: string }) {
  const values = useFilterStore(s => s.panel.values);
  const custom = useFilterStore(s => s.panel.custom);
  const watchlistOnly = useFilterStore(s => s.watchlistOnly);
  const setValue = useFilterStore(s => s.setValue);
  const setCustom = useFilterStore(s => s.setCustom);
  const setWatchlistOnly = useFilterStore(s => s.setWatchlistOnly);
  const clearAll = useFilterStore(s => s.clearAll);

  const chips = useMemo(
    () =>
      Object.entries(values).flatMap(([id, value]) => {
        const def = FILTER_BY_ID.get(id);
        return def && isValueActive(value) ? [{ id, text: describeValue(def, value) }] : [];
      }),
    [values],
  );
  const customCount = countConditions(custom);
  if (!chips.length && !customCount && !watchlistOnly) return null;

  return (
    <ul
      aria-label="Applied filters"
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {watchlistOnly ? (
        <Chip text="Watchlist only" onRemove={() => setWatchlistOnly(false)} />
      ) : null}
      {chips.map(chip => (
        <Chip key={chip.id} text={chip.text} onRemove={() => setValue(chip.id, undefined)} />
      ))}
      {customCount ? (
        <Chip
          text={`Custom · ${customCount} condition${customCount > 1 ? 's' : ''}`}
          onRemove={() => setCustom(null)}
        />
      ) : null}
      <li>
        <button
          type="button"
          onClick={clearAll}
          className="h-6 rounded-md px-1.5 text-[11px] font-medium tracking-[0.04em] text-muted uppercase hover:bg-surface-active hover:text-ink"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <li
      className="flex h-6 items-center gap-1 rounded-md border border-line bg-surface pr-0.5 pl-2 text-[11.5px] text-ink-2"
      style={{ animation: 'ep-scale-in 160ms var(--ep-ease-out) both' }}
    >
      <span className="max-w-[240px] truncate num">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${text}`}
        className="flex h-5 w-5 press items-center justify-center rounded-[4px] text-muted hover:bg-surface-active hover:text-ink"
      >
        <Icon name="x" size={11} />
      </button>
    </li>
  );
}
