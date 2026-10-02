'use client';

import { memo, useMemo } from 'react';
import type { FilterDefinition, FilterValue, RangeControl } from '@/types/filters';
import { cn } from '@/lib/cn';
import { formatBound } from '@/lib/filters/panel';
import { useStockStore } from '@/stores/stockStore';
import { NumberInput } from '@/components/ui/controls';

/**
 * Range filter: distribution histogram + dual-thumb slider + exact inputs.
 *
 * The slider is two native range inputs layered on one track, so keyboard and
 * screen-reader behaviour come from the platform. Log-scaled filters (market
 * cap, price, volume) map the thumb through log1p so the long tail is usable.
 * A thumb resting at its extreme means "no bound", which removes the condition.
 */

const STEPS = 1000;
const BINS = 32;

type RangeValue = Extract<FilterValue, { type: 'range' }>;

function toPosition(v: number, c: RangeControl): number {
  if (c.scale === 'log' && c.min >= 0) {
    return (Math.log1p(Math.max(0, v - c.min)) / Math.log1p(c.max - c.min)) * STEPS;
  }
  return ((v - c.min) / (c.max - c.min)) * STEPS;
}

function fromPosition(p: number, c: RangeControl): number {
  let v: number;
  if (c.scale === 'log' && c.min >= 0)
    v = c.min + Math.expm1((p / STEPS) * Math.log1p(c.max - c.min));
  else v = c.min + (p / STEPS) * (c.max - c.min);
  // Snap to the step, with a coarser grid on log scales as values grow.
  const step =
    c.scale === 'log'
      ? Math.max(c.step, 10 ** Math.floor(Math.log10(Math.max(1, v))) / 10)
      : c.step;
  const snapped = Math.round(v / step) * step;
  return Math.round(snapped * 1e6) / 1e6;
}

const clampPos = (p: number): number => Math.min(STEPS, Math.max(0, p));

export const RangeFilter = memo(function RangeFilter({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: RangeValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
}) {
  const control = def.control as RangeControl;
  const min = value?.min;
  const max = value?.max;
  const lo = min === undefined ? 0 : clampPos(toPosition(min, control));
  const hi = max === undefined ? STEPS : clampPos(toPosition(max, control));

  const commit = (nextMin: number | undefined, nextMax: number | undefined): void => {
    if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax)
      [nextMin, nextMax] = [nextMax, nextMin];
    if (nextMin === undefined && nextMax === undefined) {
      onChange(undefined);
      return;
    }
    onChange({
      type: 'range',
      min: nextMin,
      max: nextMax,
      // A strict bound from a preset survives until that bound is edited.
      minOp: nextMin === min ? value?.minOp : undefined,
      maxOp: nextMax === max ? value?.maxOp : undefined,
    });
  };

  const format = (v: number): string => formatBound(def.unit, v);

  return (
    <div className="space-y-2.5">
      <Histogram field={def.field} control={control} lo={lo} hi={hi} />
      <div className="relative h-4">
        <div className="absolute top-1/2 right-0 left-0 h-[2px] -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-ink"
          style={{ left: `${(lo / STEPS) * 100}%`, right: `${100 - (hi / STEPS) * 100}%` }}
        />
        <input
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={lo}
          aria-label={`${def.label} minimum`}
          aria-valuetext={min === undefined ? 'No minimum' : format(min)}
          onChange={e => {
            const p = Math.min(Number(e.target.value), hi);
            commit(p <= 0 ? undefined : fromPosition(p, control), max);
          }}
          className="ep-range"
        />
        <input
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={hi}
          aria-label={`${def.label} maximum`}
          aria-valuetext={max === undefined ? 'No maximum' : format(max)}
          onChange={e => {
            const p = Math.max(Number(e.target.value), lo);
            commit(min, p >= STEPS ? undefined : fromPosition(p, control));
          }}
          className="ep-range"
        />
      </div>
      <div className="flex items-center gap-2">
        <NumberInput
          value={min}
          label={`${def.label} minimum value`}
          placeholder={`Min ${format(control.min)}`}
          onCommit={v => commit(v, max)}
        />
        <span className="text-[11px] text-faint" aria-hidden>
          –
        </span>
        <NumberInput
          value={max}
          label={`${def.label} maximum value`}
          placeholder={`Max ${format(control.max)}`}
          onCommit={v => commit(min, v)}
        />
      </div>
    </div>
  );
});

/** Distribution of the field across the universe, with the selected band in ink. */
const Histogram = memo(function Histogram({
  field,
  control,
  lo,
  hi,
}: {
  field: string;
  control: RangeControl;
  lo: number;
  hi: number;
}) {
  const columns = useStockStore(s => s.columns);
  const { bins, nulls } = useMemo(() => {
    const out = new Array<number>(BINS).fill(0);
    const col = columns?.numbers.get(field);
    let empty = 0;
    if (col) {
      for (let i = 0; i < col.length; i++) {
        const v = col[i]!;
        if (v !== v) {
          empty++;
          continue;
        }
        const p = clampPos(toPosition(Math.min(control.max, Math.max(control.min, v)), control));
        out[Math.min(BINS - 1, Math.floor((p / STEPS) * BINS))]!++;
      }
    }
    return { bins: out, nulls: empty };
  }, [columns, field, control]);

  const peak = Math.max(1, ...bins);
  return (
    <div>
      <div className="flex h-9 items-end gap-[2px]" aria-hidden>
        {bins.map((count, b) => {
          const from = (b / BINS) * STEPS;
          const to = ((b + 1) / BINS) * STEPS;
          const inside = to > lo && from < hi;
          // Square-root scale keeps thin tails visible next to a tall mode.
          const h = count ? Math.max(2, Math.sqrt(count / peak) * 36) : 0;
          return (
            <span
              key={b}
              className={cn(
                'flex-1 rounded-t-[2px] transition-colors duration-150',
                inside ? 'bg-ink-2' : 'bg-line-strong',
              )}
              style={{ height: h }}
            />
          );
        })}
      </div>
      {nulls ? (
        <p className="mt-1 text-[10.5px] text-muted">
          {nulls.toLocaleString('en-IN')} without a value are excluded when set
        </p>
      ) : null}
    </div>
  );
});
