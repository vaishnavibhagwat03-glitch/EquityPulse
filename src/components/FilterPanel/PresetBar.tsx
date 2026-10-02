'use client';

import { useMemo, useRef, useState } from 'react';
import type { Preset } from '@/types/filters';
import { cn } from '@/lib/cn';
import { BUILT_IN_PRESETS, panelFromPreset } from '@/lib/filters/presets';
import { useFilterStore } from '@/stores/filterStore';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog, Popover } from '@/components/ui/overlays';

/**
 * Compact preset row. Presets populate the filter panel (every criterion stays
 * visible and editable); an edited preset is marked as modified rather than
 * silently diverging from its name.
 */
export function PresetBar() {
  const activeId = useFilterStore(s => s.activePresetId);
  const panel = useFilterStore(s => s.panel);
  const saved = useFilterStore(s => s.savedPresets);
  const applyPreset = useFilterStore(s => s.applyPreset);
  const [saveOpen, setSaveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  const all = useMemo(() => [...BUILT_IN_PRESETS, ...saved], [saved]);
  const active = all.find(p => p.id === activeId);
  const modified = useMemo(
    () =>
      active
        ? JSON.stringify(panelFromPreset(active).values) !== JSON.stringify(panel.values)
        : false,
    [active, panel.values],
  );
  const hasFilters = Object.keys(panel.values).length > 0 || Boolean(panel.custom);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="mr-1 hidden shrink-0 label-caps lg:inline">Screens</span>
      <div className="flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto">
        {BUILT_IN_PRESETS.slice(0, 4).map(p => (
          <PresetChip
            key={p.id}
            preset={p}
            active={p.id === activeId}
            modified={p.id === activeId && modified}
            onApply={applyPreset}
          />
        ))}
      </div>
      <button
        ref={moreRef}
        type="button"
        onClick={() => setMoreOpen(o => !o)}
        aria-expanded={moreOpen}
        className="h-7 shrink-0 rounded-md px-2 text-[11.5px] text-muted hover:bg-surface-active hover:text-ink"
      >
        More{saved.length ? ` · ${saved.length} saved` : ''}
      </button>
      <Popover
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchor={moreRef}
        width={300}
        label="More screens"
      >
        <div className="max-h-[320px] overflow-y-auto">
          {[...BUILT_IN_PRESETS.slice(4), ...saved].map(p => (
            <PresetMenuItem
              key={p.id}
              preset={p}
              active={p.id === activeId}
              onApply={preset => {
                applyPreset(preset);
                setMoreOpen(false);
              }}
            />
          ))}
        </div>
      </Popover>
      <IconButton
        icon="bookmark"
        label="Save current screen"
        disabled={!hasFilters}
        onClick={() => setSaveOpen(true)}
      />
      {saveOpen ? <SaveScreenDialog onClose={() => setSaveOpen(false)} /> : null}
    </div>
  );
}

function PresetChip({
  preset,
  active,
  modified,
  onApply,
}: {
  preset: Preset;
  active: boolean;
  modified: boolean;
  onApply: (p: Preset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onApply(preset)}
      aria-pressed={active}
      title={`${preset.description}\n${preset.criteria.join(' · ')}`}
      className={cn(
        'h-7 shrink-0 press rounded-md border px-2.5 text-[11.5px] font-medium tracking-[0.02em] whitespace-nowrap transition-colors duration-150',
        active
          ? 'border-transparent bg-surface-inverse text-ink-inverse'
          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {preset.name}
      {modified ? <span className="ml-1 opacity-70">· modified</span> : null}
    </button>
  );
}

function PresetMenuItem({
  preset,
  active,
  onApply,
}: {
  preset: Preset;
  active: boolean;
  onApply: (p: Preset) => void;
}) {
  const deletePreset = useFilterStore(s => s.deletePreset);
  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-md px-2 py-1.5',
        active ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      <button type="button" onClick={() => onApply(preset)} className="min-w-0 flex-1 text-left">
        <span className="block text-[12.5px] text-ink">{preset.name}</span>
        <span className="block truncate text-[11px] text-muted">
          {preset.criteria.join(' · ') || preset.description}
        </span>
      </button>
      {!preset.builtIn ? (
        <IconButton
          icon="trash"
          size="xs"
          label={`Delete ${preset.name}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => deletePreset(preset.id)}
        />
      ) : null}
    </div>
  );
}

function SaveScreenDialog({ onClose }: { onClose: () => void }) {
  const savePreset = useFilterStore(s => s.savePreset);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (): void => {
    if (!name.trim()) return;
    savePreset(name);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="save-screen-title"
      className="max-w-[400px]"
      initialFocus={inputRef}
    >
      <form
        className="p-5"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="save-screen-title" className="text-[13.5px] font-semibold text-ink">
          Save screen
        </h2>
        <p className="mt-1 text-xs text-muted">
          Saved screens live in this browser and appear under More.
        </p>
        <label className="mt-4 block">
          <span className="label-caps">Name</span>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Quality compounders"
            className="mt-1.5 h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Save screen
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
