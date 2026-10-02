/**
 * Performance instrumentation.
 *
 * Every number in PERFORMANCE_REPORT.md comes from these collectors, read
 * either through the in-app performance monitor (palette → "Performance
 * monitor") or by `scripts/measure-runtime.mjs` via `window.__EQUITYPULSE_PERF__`.
 *
 * Collection is cheap by construction: ring buffers, no allocation on the hot
 * path, receipt-to-render latency sampled, FPS sampling only while requested.
 */

class Ring {
  private readonly values: Float64Array;
  private index = 0;
  count = 0;
  last: number | null = null;

  constructor(private readonly capacity: number) {
    this.values = new Float64Array(capacity);
  }

  push(v: number): void {
    this.values[this.index] = v;
    this.index = (this.index + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.last = v;
  }

  sorted(): number[] {
    return Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
  }

  quantile(q: number): number | null {
    if (!this.count) return null;
    const s = this.sorted();
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  }

  mean(): number | null {
    if (!this.count) return null;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.values[i]!;
    return sum / this.count;
  }

  max(): number | null {
    if (!this.count) return null;
    let m = -Infinity;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.values[i]!);
    return m;
  }

  reset(): void {
    this.index = 0;
    this.count = 0;
    this.last = null;
  }
}

export interface SeriesSummary {
  last: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
  count: number;
}

const summarise = (r: Ring): SeriesSummary => ({
  last: r.last,
  p50: r.quantile(0.5),
  p95: r.quantile(0.95),
  max: r.max(),
  mean: r.mean(),
  count: r.count,
});

const series = {
  filter: new Ring(300),
  sort: new Ring(300),
  tickLatency: new Ring(1000),
  fps: new Ring(240),
  frame: new Ring(600),
  flush: new Ring(600),
};

const gauges: Record<string, number> = {};
const vitals: Record<string, number> = {};
const longTasks = { count: 0, totalMs: 0, blockingMs: 0 };

let latencySample = 0;

export const recordFilter = (ms: number): void => series.filter.push(ms);
export const recordSort = (ms: number): void => series.sort.push(ms);
export const recordFlush = (ms: number): void => series.flush.push(ms);

/** Called from the price cell's layout effect; samples 1 in 4 to stay off the hot path. */
export function recordTickLatency(rx: number): void {
  if (!rx || (latencySample++ & 3) !== 0) return;
  const latency = performance.now() - rx;
  if (latency >= 0 && latency < 10_000) series.tickLatency.push(latency);
}

export function setGauge(name: string, value: number): void {
  gauges[name] = value;
}

/* ---------------------------------------------------------------- FPS */

let fpsRaf: number | null = null;
let fpsUsers = 0;

export function startFpsMonitor(): () => void {
  fpsUsers++;
  if (fpsRaf === null && typeof requestAnimationFrame === 'function') {
    // Frame timing uses only rAF timestamps: the first frame opens the window.
    let windowStart = -1;
    let frames = 0;
    let previous = 0;
    const loop = (t: number): void => {
      if (windowStart < 0) {
        windowStart = previous = t;
        fpsRaf = requestAnimationFrame(loop);
        return;
      }
      frames++;
      series.frame.push(t - previous);
      previous = t;
      if (t - windowStart >= 500) {
        series.fps.push((frames * 1000) / (t - windowStart));
        frames = 0;
        windowStart = t;
      }
      fpsRaf = requestAnimationFrame(loop);
    };
    fpsRaf = requestAnimationFrame(loop);
  }
  return () => {
    fpsUsers = Math.max(0, fpsUsers - 1);
    if (fpsUsers === 0 && fpsRaf !== null) {
      cancelAnimationFrame(fpsRaf);
      fpsRaf = null;
    }
  };
}

/* --------------------------------------------------------- web vitals */

let vitalsStarted = false;

export function initPerformanceObservers(): void {
  if (vitalsStarted || typeof window === 'undefined') return;
  vitalsStarted = true;

  // Off the critical path: web-vitals loads after hydration.
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const store = (m: { name: string; value: number }): void => {
      vitals[m.name] = m.value;
    };
    onLCP(store, { reportAllChanges: true });
    onCLS(store, { reportAllChanges: true });
    onINP(store, { reportAllChanges: true });
    onFCP(store);
    onTTFB(store);
  });

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        longTasks.count++;
        longTasks.totalMs += entry.duration;
        longTasks.blockingMs += Math.max(0, entry.duration - 50);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long Task API is Chromium-only.
  }

  (window as unknown as { __EQUITYPULSE_PERF__: unknown }).__EQUITYPULSE_PERF__ = {
    snapshot: snapshotPerformance,
    reset: resetPerformance,
    startFps: startFpsMonitor,
  };
}

/* ---------------------------------------------------------- snapshot */

export interface PerformanceSnapshot {
  filterMs: SeriesSummary;
  sortMs: SeriesSummary;
  tickLatencyMs: SeriesSummary;
  fps: SeriesSummary;
  frameMs: SeriesSummary;
  flushMs: SeriesSummary;
  vitals: Record<string, number>;
  gauges: Record<string, number>;
  longTasks: typeof longTasks;
  heapMB: number | null;
  domNodes: number | null;
}

export function snapshotPerformance(): PerformanceSnapshot {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    filterMs: summarise(series.filter),
    sortMs: summarise(series.sort),
    tickLatencyMs: summarise(series.tickLatency),
    fps: summarise(series.fps),
    frameMs: summarise(series.frame),
    flushMs: summarise(series.flush),
    vitals: { ...vitals },
    gauges: { ...gauges },
    longTasks: { ...longTasks },
    heapMB: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
    domNodes: typeof document !== 'undefined' ? document.getElementsByTagName('*').length : null,
  };
}

export function resetPerformance(): void {
  Object.values(series).forEach(r => r.reset());
  longTasks.count = 0;
  longTasks.totalMs = 0;
  longTasks.blockingMs = 0;
}

/** Times a synchronous block and records it into a series. */
export function timed<T>(record: (ms: number) => void, fn: () => T): T {
  const t0 = performance.now();
  const result = fn();
  record(performance.now() - t0);
  return result;
}
