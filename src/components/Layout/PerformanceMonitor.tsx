'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  resetPerformance,
  snapshotPerformance,
  startFpsMonitor,
  type PerformanceSnapshot,
  type SeriesSummary,
} from '@/lib/performance';
import { useUiStore } from '@/stores/uiStore';
import { IconButton } from '@/components/ui/Button';

/**
 * Live performance monitor (palette → "Performance monitor", or PERF in the
 * status bar). Shows measured values against the brief's targets; the same
 * collectors feed scripts/measure-runtime.mjs and PERFORMANCE_REPORT.md.
 */

const fmt = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);

function Metric({
  label,
  value,
  unit,
  target,
  ok,
}: {
  label: string;
  value: string;
  unit?: string;
  target?: string;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn('num text-[11.5px]', ok === false ? 'down' : 'text-ink')}>
          {value}
          {unit && value !== '—' ? <span className="ml-0.5 text-muted">{unit}</span> : null}
        </span>
        {target ? (
          <span className="w-[52px] text-right num text-[10px] text-faint">{target}</span>
        ) : null}
      </span>
    </div>
  );
}

const seriesText = (s: SeriesSummary, digits = 2): string =>
  s.count ? `${fmt(s.p50, digits)} / ${fmt(s.p95, digits)}` : '—';

export default function PerformanceMonitor() {
  const setPerf = useUiStore(s => s.setPerf);
  const [snap, setSnap] = useState<PerformanceSnapshot | null>(null);

  useEffect(() => {
    const stopFps = startFpsMonitor();
    const tick = (): void => setSnap(snapshotPerformance());
    tick();
    const id = setInterval(tick, 500);
    return () => {
      clearInterval(id);
      stopFps();
    };
  }, []);

  if (!snap) return null;
  const v = snap.vitals;
  return (
    <aside
      aria-label="Performance monitor"
      className="fixed right-3 bottom-[calc(var(--status-height)+12px)] z-40 w-[288px] rounded-lg border border-line bg-surface/95 p-3 shadow-lg backdrop-blur-md"
      style={{ animation: 'ep-rise-in 200ms var(--ep-ease-out) both' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="label-caps">Performance · measured</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={resetPerformance}
            className="rounded-sm px-1.5 text-[10.5px] text-muted hover:bg-surface-active hover:text-ink"
          >
            Reset
          </button>
          <IconButton
            icon="x"
            size="xs"
            label="Close performance monitor"
            onClick={() => setPerf(false)}
          />
        </div>
      </div>
      <p className="mb-1 text-[10px] text-faint">value · target (p50 / p95 where shown)</p>
      <Metric
        label="Frame rate"
        value={fmt(snap.fps.last, 0)}
        unit="fps"
        target="> 55"
        ok={snap.fps.last === null ? null : snap.fps.last > 55}
      />
      <Metric
        label="Frame time p95"
        value={fmt(snap.frameMs.p95, 1)}
        unit="ms"
        target="< 18"
        ok={snap.frameMs.p95 === null ? null : snap.frameMs.p95 < 18.2}
      />
      <Metric
        label="Filter"
        value={seriesText(snap.filterMs)}
        unit="ms"
        target="< 200"
        ok={snap.filterMs.p95 === null ? null : snap.filterMs.p95 < 200}
      />
      <Metric
        label="Sort"
        value={seriesText(snap.sortMs)}
        unit="ms"
        target="< 150"
        ok={snap.sortMs.p95 === null ? null : snap.sortMs.p95 < 150}
      />
      <Metric
        label="Tick → render"
        value={seriesText(snap.tickLatencyMs, 1)}
        unit="ms"
        target="< 50"
        ok={snap.tickLatencyMs.p95 === null ? null : snap.tickLatencyMs.p95 < 50}
      />
      <Metric label="Batch apply" value={seriesText(snap.flushMs, 2)} unit="ms" />
      <div className="my-2 h-px bg-line" />
      <Metric
        label="LCP"
        value={v.LCP ? fmt(v.LCP / 1000, 2) : '—'}
        unit="s"
        target="< 2.5"
        ok={v.LCP ? v.LCP < 2500 : null}
      />
      <Metric
        label="CLS"
        value={v.CLS !== undefined ? fmt(v.CLS, 3) : '—'}
        target="< 0.1"
        ok={v.CLS !== undefined ? v.CLS < 0.1 : null}
      />
      <Metric
        label="INP"
        value={v.INP ? fmt(v.INP, 0) : '—'}
        unit="ms"
        target="< 200"
        ok={v.INP ? v.INP < 200 : null}
      />
      <Metric label="FCP" value={v.FCP ? fmt(v.FCP / 1000, 2) : '—'} unit="s" />
      <div className="my-2 h-px bg-line" />
      <Metric
        label="JS heap"
        value={fmt(snap.heapMB, 1)}
        unit="MB"
        target="< 150"
        ok={snap.heapMB === null ? null : snap.heapMB < 150}
      />
      <Metric label="DOM nodes" value={snap.domNodes ? String(snap.domNodes) : '—'} />
      <Metric
        label="Grid rows in DOM"
        value={
          snap.gauges.gridRows !== undefined
            ? `${snap.gauges.gridRows} / ${snap.gauges.gridTotal ?? '—'}`
            : '—'
        }
      />
      <Metric label="Universe decode" value={fmt(snap.gauges.universeDecodeMs, 1)} unit="ms" />
      <Metric
        label="Long tasks"
        value={`${snap.longTasks.count} · ${fmt(snap.longTasks.blockingMs, 0)} ms TBT`}
      />
    </aside>
  );
}
