'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Candle, Timeframe } from '@/types/market';
import { cn } from '@/lib/cn';
import {
  applyTick,
  buildChartModel,
  INDICATORS,
  reconcileWithQuote,
  TIMEFRAMES,
  TIMEFRAME_BY_ID,
  type ChartModel,
  type IndicatorId,
} from '@/lib/chartData';
import {
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatShortTime,
  formatSigned,
} from '@/lib/format';
import { useHistory } from '@/hooks/useHistory';
import { useHotkeys } from '@/hooks/useHotkeys';
import { getQuote, useQuote } from '@/stores/stockStore';
import { useUiStore } from '@/stores/uiStore';
import { IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/controls';
import { ChartController, readChartTheme, type CrosshairInfo } from './chartRenderer';
import { ChartSkeleton } from './ChartSkeleton';

/**
 * Interactive candlestick chart. Loaded with next/dynamic on the stock page
 * only, so Lightweight Charts never ships in the screener or home bundles.
 */

const INDICATOR_KEY = 'ep:chart:indicators';
const TIMEFRAME_KEY = 'ep:chart:timeframe';
const DEFAULT_INDICATORS: IndicatorId[] = ['sma50', 'sma200'];

function loadIndicators(): Set<IndicatorId> {
  try {
    const raw = localStorage.getItem(INDICATOR_KEY);
    if (raw) return new Set(JSON.parse(raw) as IndicatorId[]);
  } catch {
    // Storage unavailable: defaults.
  }
  return new Set(DEFAULT_INDICATORS);
}

function loadTimeframe(): Timeframe {
  try {
    const raw = localStorage.getItem(TIMEFRAME_KEY) as Timeframe | null;
    if (raw && TIMEFRAME_BY_ID.has(raw)) return raw;
  } catch {
    // Storage unavailable: default.
  }
  return '3M';
}

const isIntraday = (tf: Timeframe): boolean => tf === '1D' || tf === '1W';

export default function StockChart({ symbol, height = 460 }: { symbol: string; height?: number }) {
  const chartFault = useUiStore(s => s.chartFault);

  // The chart is client-only (dynamic import, ssr: false), so the stored
  // choices can be read straight into the initial state.
  const [timeframe, setTimeframe] = useState<Timeframe>(loadTimeframe);
  const [enabled, setEnabled] = useState<Set<IndicatorId>>(loadIndicators);

  const spec = TIMEFRAME_BY_ID.get(timeframe)!;
  const history = useHistory(symbol, spec.interval);
  const quote = useQuote(symbol);

  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ChartController | null>(null);
  const candlesRef = useRef<Candle[] | null>(null);
  const modelRef = useRef<ChartModel | null>(null);
  const lastVolume = useRef<number | null>(null);
  const [info, setInfo] = useState<CrosshairInfo | null>(null);

  // Build the model once per payload, reconciled with the live quote.
  const model = useMemo(() => {
    const candles = history.data?.data.candles;
    if (!candles?.length) return null;
    const reconciled = reconcileWithQuote(candles, spec.interval, getQuote(symbol));
    return buildChartModel(reconciled, spec.interval);
  }, [history.data, spec.interval, symbol]);

  // Chart lifecycle: created once, destroyed on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame: number | null = null;
    let pending: CrosshairInfo | null = null;
    const controller = new ChartController(el, readChartTheme(), next => {
      pending = next;
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          setInfo(pending);
        });
      }
    });
    controllerRef.current = controller;
    // Lightweight Charts lays its panes out with a <table>; it is not data.
    el.querySelectorAll('table').forEach(table => table.setAttribute('role', 'presentation'));

    const themeObserver = new MutationObserver(() => controller.applyTheme(readChartTheme()));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const resizeObserver = new ResizeObserver(() => controller.resize());
    resizeObserver.observe(el);
    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!model || !controllerRef.current) return;
    candlesRef.current = model.candles.map(c => ({ ...c }));
    modelRef.current = model;
    lastVolume.current = getQuote(symbol)?.volume ?? null;
    controllerRef.current.setModel(model, spec.visibleBars);
    controllerRef.current.setEnabled(enabled);
    // `enabled` is applied by its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, spec.visibleBars, symbol]);

  useEffect(() => {
    controllerRef.current?.setEnabled(enabled);
    try {
      localStorage.setItem(INDICATOR_KEY, JSON.stringify([...enabled]));
    } catch {
      // Ignore storage failures.
    }
  }, [enabled]);

  // Live ticks: update today's bar (or open a new intraday bucket). Indicators
  // for the last point are recomputed at most every 250 ms.
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appendedRef = useRef(false);
  useEffect(() => {
    const candles = candlesRef.current;
    if (!quote || !candles || !controllerRef.current) return;
    const delta = lastVolume.current === null ? 0 : quote.volume - lastVolume.current;
    lastVolume.current = quote.volume;
    const { appended } = applyTick(candles, spec.interval, quote.price, delta, quote.ts);
    appendedRef.current ||= appended;
    if (updateTimer.current) return;
    updateTimer.current = setTimeout(() => {
      updateTimer.current = null;
      const next = buildChartModel(candles, spec.interval);
      modelRef.current = next;
      controllerRef.current?.updateLast(next, appendedRef.current);
      appendedRef.current = false;
    }, 250);
  }, [quote, spec.interval]);
  useEffect(
    () => () => {
      if (updateTimer.current) clearTimeout(updateTimer.current);
    },
    [],
  );

  const changeTimeframe = useCallback((tf: Timeframe) => {
    setTimeframe(tf);
    try {
      localStorage.setItem(TIMEFRAME_KEY, tf);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const toggle = (id: IndicatorId): void =>
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useHotkeys(
    Object.fromEntries(TIMEFRAMES.map((t, i) => [String(i + 1), () => changeTimeframe(t.id)])),
  );

  const onChartKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const c = controllerRef.current;
    if (!c) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => c.pan(-10),
      ArrowRight: () => c.pan(10),
      '+': () => c.zoom(0.8),
      '=': () => c.zoom(0.8),
      '-': () => c.zoom(1.25),
      '0': () => c.resetView(),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const loading = history.isPending;
  const failed = history.isError && !model;
  // Fault injection (palette → Simulate chart failure) exercises the error boundary.
  if (chartFault) throw new Error('Simulated chart failure (fault injection)');

  return (
    <section aria-label={`${symbol} price chart`} className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <Segmented
          label="Timeframe"
          value={timeframe}
          onChange={changeTimeframe}
          options={TIMEFRAMES.map((t, i) => ({
            value: t.id,
            label: t.label,
            title: `${t.description} (${i + 1})`,
          }))}
        />
        <span className="hidden text-[11px] text-muted md:inline">{spec.description}</span>
        <div
          className="ml-auto flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Indicators"
        >
          {INDICATORS.map(ind => {
            const on = enabled.has(ind.id);
            return (
              <button
                key={ind.id}
                type="button"
                aria-pressed={on}
                title={ind.description}
                onClick={() => toggle(ind.id)}
                className={cn(
                  'flex h-6 press items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors duration-150',
                  on
                    ? 'border-line-strong bg-surface text-ink'
                    : 'border-transparent text-muted hover:bg-surface-active hover:text-ink',
                )}
              >
                <Swatch id={ind.id} colorVar={ind.colorVar} faded={!on} />
                {ind.label}
              </button>
            );
          })}
          <IconButton
            icon="reset"
            size="xs"
            label="Reset chart view (0)"
            onClick={() => controllerRef.current?.resetView()}
          />
        </div>
      </div>

      <div className="relative">
        <Legend info={info} enabled={enabled} intraday={isIntraday(timeframe)} />
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-roledescription="chart"
          onKeyDown={onChartKey}
          onDoubleClick={() => controllerRef.current?.resetView()}
          aria-label="Interactive chart. Scroll or +/− to zoom, drag or ←/→ to pan, 0 or double-click to reset."
          className="w-full outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ring)]"
          style={{ height }}
        />
        {loading ? (
          <div className="absolute inset-0 bg-surface">
            <ChartSkeleton height={height} />
          </div>
        ) : null}
        {failed ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface"
          >
            <p className="text-sm text-ink">Chart data unavailable.</p>
            <button
              type="button"
              onClick={() => history.refetch()}
              className="text-xs font-medium tracking-[0.06em] text-accent uppercase hover:underline"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[10.5px] text-faint">
        Simulated prices. Charting by{' '}
        <a
          href="https://www.tradingview.com/lightweight-charts/"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:text-muted hover:underline"
        >
          TradingView Lightweight Charts™
        </a>
      </p>
    </section>
  );
}

function Swatch({ id, colorVar, faded }: { id: IndicatorId; colorVar: string; faded?: boolean }) {
  if (id === 'vp') {
    return (
      <span
        aria-hidden
        className={cn('flex h-2.5 w-3 flex-col justify-between', faded && 'opacity-50')}
      >
        <span className="h-[2px] w-2 self-end rounded-[1px] bg-faint" />
        <span className="h-[2px] w-3 self-end rounded-[1px] bg-muted" />
        <span className="h-[2px] w-1.5 self-end rounded-[1px] bg-faint" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn('h-[2px] w-3 rounded-full', faded && 'opacity-50')}
      style={{ background: `var(${colorVar})` }}
    />
  );
}

/** OHLCV + indicator readout. Follows the crosshair; shows the last bar otherwise. */
function Legend({
  info,
  enabled,
  intraday,
}: {
  info: CrosshairInfo | null;
  enabled: ReadonlySet<IndicatorId>;
  intraday: boolean;
}) {
  if (!info) return null;
  const c = info.candle;
  const up = info.change >= 0;
  const when = intraday ? `${formatShortTime(c.time * 1000)} IST` : formatDate(c.time * 1000);
  const v = info.values;
  const field = (label: string, value: string) => (
    <span className="whitespace-nowrap">
      <span className="text-muted">{label}</span> <span className="text-ink">{value}</span>
    </span>
  );
  return (
    <div className="pointer-events-none absolute top-2 left-3 z-10 max-w-[calc(100%-96px)] space-y-1 rounded-md bg-surface/85 px-2 py-1 backdrop-blur-[2px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 num text-[11px]">
        <span className="text-muted">{when}</span>
        {field('O', formatNumber(c.open, 2))}
        {field('H', formatNumber(c.high, 2))}
        {field('L', formatNumber(c.low, 2))}
        {field('C', formatNumber(c.close, 2))}
        <span className={up ? 'up' : 'down'}>
          {formatSigned(info.change)} ({formatPercent(info.changePercent, { signed: true })})
        </span>
        {field('V', formatCompact(c.volume))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 num text-[11px]">
        {INDICATORS.filter(i => enabled.has(i.id) && i.id !== 'vp').map(ind => {
          const value = ind.id === 'bb' ? v.bb : v[ind.id];
          const text =
            ind.id === 'bb'
              ? v.bbUpper !== undefined && v.bbLower !== undefined
                ? `${formatNumber(v.bbLower, 2)} – ${formatNumber(v.bbUpper, 2)}`
                : '—'
              : value === undefined
                ? '—'
                : formatNumber(value, ind.id === 'rsi' ? 1 : 2);
          return (
            <span key={ind.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                aria-hidden
                className="h-[2px] w-2.5 rounded-full"
                style={{ background: `var(${ind.colorVar})` }}
              />
              <span className="text-muted">{ind.label}</span>
              <span className="text-ink">{text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
