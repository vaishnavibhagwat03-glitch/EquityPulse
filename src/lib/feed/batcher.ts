/**
 * Coalesces tick updates and flushes them at most once per animation frame.
 *
 * Ten updates to one symbol inside a frame cost one store update and one cell
 * render. A timer runs alongside requestAnimationFrame because rAF is paused in
 * hidden tabs; whichever fires first flushes and cancels the other.
 */

export interface PendingTick {
  symbol: string;
  price: number;
  volume: number;
  ts: number;
  rx: number;
}

export interface BatcherScheduler {
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  setTimeout(cb: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

const browserScheduler = (): BatcherScheduler => ({
  requestFrame: cb =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : (setTimeout(cb, 16) as unknown as number),
  cancelFrame: id =>
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: id => clearTimeout(id),
});

export class TickBatcher {
  private pending = new Map<string, PendingTick>();
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduler: BatcherScheduler;
  readonly stats = { received: 0, flushed: 0, batches: 0 };

  constructor(
    private readonly onFlush: (ticks: PendingTick[]) => void,
    private readonly fallbackMs = 150,
    scheduler?: BatcherScheduler,
  ) {
    this.scheduler = scheduler ?? browserScheduler();
  }

  push(ticks: Iterable<PendingTick>): void {
    for (const t of ticks) {
      this.pending.set(t.symbol, t);
      this.stats.received++;
    }
    if (this.pending.size && this.frame === null && this.timer === null) {
      this.frame = this.scheduler.requestFrame(this.fire);
      this.timer = this.scheduler.setTimeout(this.fire, this.fallbackMs);
    }
  }

  private fire = (): void => {
    this.cancel();
    if (!this.pending.size) return;
    const batch = [...this.pending.values()];
    this.pending = new Map();
    this.stats.flushed += batch.length;
    this.stats.batches++;
    this.onFlush(batch);
  };

  private cancel(): void {
    if (this.frame !== null) this.scheduler.cancelFrame(this.frame);
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.frame = null;
    this.timer = null;
  }

  flushNow(): void {
    this.fire();
  }

  dispose(): void {
    this.cancel();
    this.pending.clear();
  }
}
