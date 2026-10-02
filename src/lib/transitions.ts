/**
 * Shared-element page transitions via the View Transitions API.
 *
 * `navigateWithTransition` snapshots the current page, runs the navigation, and
 * holds the transition open until the destination calls
 * `resolvePendingTransition()` from its first layout effect — so the browser
 * morphs between elements that share a `view-transition-name` (the market
 * grid becomes the screener grid). Falls back to a plain navigation where the
 * API is missing or the user prefers reduced motion.
 */

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

let pending: (() => void) | null = null;

export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return typeof (document as ViewTransitionDocument).startViewTransition === 'function';
}

export function navigateWithTransition(navigate: () => void, timeoutMs = 900): void {
  const doc = document as ViewTransitionDocument;
  if (!supportsViewTransitions() || !doc.startViewTransition) {
    navigate();
    return;
  }
  doc.startViewTransition(
    () =>
      new Promise<void>(resolve => {
        const done = (): void => {
          pending = null;
          resolve();
        };
        pending = done;
        navigate();
        // Never hold the page hostage if the destination is slow to mount.
        setTimeout(() => pending === done && done(), timeoutMs);
      }),
  );
}

export function resolvePendingTransition(): void {
  pending?.();
}
