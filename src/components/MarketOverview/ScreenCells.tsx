'use client';

import type { Preset } from '@/types/filters';
import { formatInteger, formatPercent } from '@/lib/format';
import { BUILT_IN_PRESETS } from '@/lib/filters/presets';
import { usePresetCounts } from '@/hooks/usePresetCounts';
import { useFilterStore } from '@/stores/filterStore';
import { useStockStore } from '@/stores/stockStore';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/primitives';
import { emergeStyle } from './emerge';

/**
 * The built-in screens with their live match counts, run by the screener's
 * own engine. Opening one applies it to the filter panel (every criterion
 * stays visible and editable) and hands over to the screener.
 */
export function ScreenCells({
  onOpen,
  firstEmerge,
}: {
  onOpen: (prepare: () => void) => void;
  firstEmerge: number;
}) {
  const counts = usePresetCounts(BUILT_IN_PRESETS);
  const total = useStockStore(s => s.stocks.length);
  return (
    <>
      {BUILT_IN_PRESETS.map((preset, i) => (
        <ScreenCell
          key={preset.id}
          preset={preset}
          count={counts ? counts[i]! : null}
          total={total}
          emerge={firstEmerge + i}
          onOpen={() => onOpen(() => useFilterStore.getState().applyPreset(preset))}
        />
      ))}
    </>
  );
}

function ScreenCell({
  preset,
  count,
  total,
  emerge,
  onOpen,
}: {
  preset: Preset;
  count: number | null;
  total: number;
  emerge: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-emerge
      style={emergeStyle(emerge)}
      onClick={onOpen}
      className="group col-span-12 flex min-h-[148px] min-w-0 flex-col gap-2 bg-surface p-4 text-left transition-colors duration-150 hover:bg-surface-hover sm:col-span-6 lg:col-span-4 xl:col-span-2"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] leading-[18px] font-semibold text-ink">
          {preset.name}
        </span>
        {count === null ? (
          <span className="flex shrink-0">
            <Skeleton className="h-5 w-10" />
            <span className="sr-only">counting matches</span>
          </span>
        ) : (
          <span className="shrink-0 num text-[19px] leading-5 text-ink">
            {formatInteger(count)}
            <span className="sr-only"> matches</span>
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-[12px] leading-[17px] text-muted">
        {preset.description}
      </span>
      <span className="mt-auto num text-[10.5px] leading-[15px] text-faint">
        {preset.criteria.join(' · ')}
      </span>
      <span className="flex items-center justify-between gap-2 text-[11.5px]">
        <span className="flex items-center gap-1 font-medium text-ink-2">
          Screen
          <Icon
            name="arrow-right"
            size={12}
            className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
          />
        </span>
        <span className="truncate num text-[10.5px] text-faint">
          {count !== null && total
            ? `${formatPercent((count / total) * 100, { decimals: 1 })} of universe`
            : 'matches'}
        </span>
      </span>
    </button>
  );
}
