import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryKeys } from '@/lib/api';
import {
  initPerformanceObservers,
  recordFilter,
  recordSort,
  recordTickLatency,
  resetPerformance,
  setGauge,
  snapshotPerformance,
  startFpsMonitor,
  timed,
} from '@/lib/performance';
import { applyTheme } from '@/lib/theme';
import {
  navigateWithTransition,
  resolvePendingTransition,
  supportsViewTransitions,
} from '@/lib/transitions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useHistory } from '@/hooks/useHistory';
import { isTypingTarget, useHotkeys } from '@/hooks/useHotkeys';
import {
  useIsDesktop,
  useIsMobile,
  useIsWide,
  usePrefersReducedMotion,
} from '@/hooks/useMediaQuery';
import { useLiveStock } from '@/hooks/useLiveStock';
import { useStockStore } from '@/stores/stockStore';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse } from '../helpers/render';

const envelope = (data: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      success: true,
      data,
      meta: { timestamp: 't', executionTimeMs: 1, requestId: 'r', ...extra },
    }),
  );

describe('API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope([{ name: 'Banking' }], { count: 1 })),
    );
    const result = await api.sectors();
    expect(result.data).toEqual([{ name: 'Banking' }]);
    expect(result.meta.count).toBe(1);
  });

  it('turns failures into typed errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              data: null,
              meta: {},
              error: { code: 'NOT_FOUND', message: 'No security', details: ['x'] },
            }),
            { status: 404 },
          ),
      ),
    );
    const error = await api.stock('NOPE').catch(e => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      details: ['x'],
      message: 'No security',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>oops</html>', { status: 502 })),
    );
    await expect(api.market()).rejects.toMatchObject({ code: 'BAD_RESPONSE', status: 502 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api.indices()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('posts a preset as JSON and builds stable query keys', async () => {
    const fetchMock = vi.fn(async () => envelope({ id: 'user-x' }));
    vi.stubGlobal('fetch', fetchMock);
    await api.savePreset({ name: 'x', panel: { values: {} } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/filters/presets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'x', panel: { values: {} } });
    expect(queryKeys.history('TCS', '1d')).toEqual(['history', 'TCS', '1d']);
  });
});

describe('performance instrumentation', () => {
  beforeEach(() => resetPerformance());

  it('summarises series with percentiles', () => {
    for (let i = 1; i <= 100; i++) recordFilter(i);
    recordSort(7);
    const snap = snapshotPerformance();
    expect(snap.filterMs).toMatchObject({
      count: 100,
      last: 100,
      max: 100,
      p50: 51,
      p95: 96,
      mean: 50.5,
    });
    expect(snap.sortMs.p50).toBe(7);
    expect(snap.tickLatencyMs.count).toBe(0);
    expect(snap.domNodes).toBeGreaterThan(0);
  });

  it('samples tick latency and times blocks', () => {
    const now = performance.now();
    for (let i = 0; i < 8; i++) recordTickLatency(now - 5);
    recordTickLatency(0); // no receipt time: ignored
    expect(snapshotPerformance().tickLatencyMs.count).toBe(2); // one in four
    expect(timed(recordSort, () => 42)).toBe(42);
    expect(snapshotPerformance().sortMs.count).toBe(1);
    setGauge('gridRows', 31);
    expect(snapshotPerformance().gauges.gridRows).toBe(31);
  });

  it('measures frame rate only while asked to', async () => {
    const stop = startFpsMonitor();
    await waitFor(() => expect(snapshotPerformance().fps.count).toBeGreaterThan(0), {
      timeout: 2000,
    });
    stop();
    expect(snapshotPerformance().frameMs.count).toBeGreaterThan(0);
  });

  it('exposes the collectors to the measurement scripts', () => {
    initPerformanceObservers();
    const handle = (window as unknown as { __EQUITYPULSE_PERF__: { snapshot: () => unknown } })
      .__EQUITYPULSE_PERF__;
    expect(typeof handle.snapshot).toBe('function');
  });
});

describe('view transitions and theme', () => {
  it('navigates directly where view transitions are unavailable', () => {
    const navigate = vi.fn();
    expect(supportsViewTransitions()).toBe(false);
    navigateWithTransition(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('holds the transition until the destination is ready, with a timeout', async () => {
    vi.useFakeTimers();
    let finished: Promise<void> | null = null;
    const doc = document as unknown as {
      startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> };
    };
    doc.startViewTransition = cb => {
      finished = cb();
      return { finished: finished! };
    };
    const navigate = vi.fn();
    navigateWithTransition(navigate, 900);
    expect(navigate).toHaveBeenCalled();
    resolvePendingTransition();
    await expect(finished).resolves.toBeUndefined();

    navigateWithTransition(vi.fn(), 900);
    vi.advanceTimersByTime(900); // the destination never reported in
    await expect(finished).resolves.toBeUndefined();
    delete doc.startViewTransition;
    vi.useRealTimers();
  });

  it('applies the resolved theme to the document', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    applyTheme('light');
  });
});

describe('hooks', () => {
  it('keyboard shortcuts: modifiers, sequences, and never while typing', () => {
    const open = vi.fn();
    const slash = vi.fn();
    const go = vi.fn();
    renderHook(() => useHotkeys({ 'mod+k': open, '/': slash, 'g s': go }));
    const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
      act(
        () =>
          void target.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
          ),
      );

    press('k', { ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    press('/');
    expect(slash).toHaveBeenCalledTimes(1);
    press('g');
    press('s');
    expect(go).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.appendChild(input);
    press('/', {}, input);
    expect(slash).toHaveBeenCalledTimes(1); // typing a slash is not a shortcut
    press('k', { metaKey: true }, input);
    expect(open).toHaveBeenCalledTimes(2); // ⌘K works everywhere
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    input.remove();
  });

  it('debounces a value', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    rerender({ v: 3 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBe(3);
    vi.useRealTimers();
  });

  it('reads the layout breakpoints', () => {
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
    expect(renderHook(() => useIsWide()).result.current).toBe(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it('applies live quotes to a stock', () => {
    const model = market(40);
    loadUniverse(model);
    const s = model.stocks[0]!;
    const { result } = renderHook(() => useLiveStock(s.symbol));
    expect(result.current!.price).toBe(s.price);
    act(() => {
      useStockStore
        .getState()
        .applySnapshot([[s.symbol, s.price, s.dayHigh, s.dayLow, s.volume, s.previousClose]], 1);
      useStockStore
        .getState()
        .applyTicks([{ symbol: s.symbol, price: s.price * 2, volume: s.volume, ts: 2, rx: 0 }]);
    });
    expect(result.current!.price).toBe(s.price * 2);
    expect(result.current!.pe).not.toBe(s.pe);
  });

  it('loads history and refreshes the universe when the server has moved on', async () => {
    const model = market(40);
    loadUniverse(model);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const base = historyFetch(model);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const res = await base(input);
      const body = await res.json();
      return new Response(
        JSON.stringify({ ...body, meta: { ...body.meta, version: 'a-newer-day' } }),
      );
    });
    const { result } = renderHook(() => useHistory(model.stocks[0]!.symbol, '1d'), { wrapper });
    await waitFor(() => expect(result.current.data?.data.candles.length).toBeGreaterThan(252));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.universe }));
    vi.unstubAllGlobals();
  });
});
