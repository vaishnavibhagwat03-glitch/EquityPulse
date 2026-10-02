/**
 * Whether the user is scrolling a results grid right now.
 *
 * Live re-screens (see useStockScreener) can reorder every row in view. Doing
 * that under a scrolling user is disorienting, and it lands a full repaint of
 * the window on top of the scroll's own work; so they wait for a pause.
 * Module-level on purpose: scrolling must not cause React renders.
 */

let lastScroll = Number.NEGATIVE_INFINITY;

export function noteScroll(): void {
  lastScroll = performance.now();
}

export function isScrolling(withinMs = 300): boolean {
  return performance.now() - lastScroll < withinMs;
}
