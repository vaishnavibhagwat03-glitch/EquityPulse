'use client';

import { useEffect, useState } from 'react';

/**
 * True once the page has loaded and painted, and — unless `urgent` — the
 * browser has had a moment of idle time. Used to start the market-universe
 * download after the server-rendered page is on screen, so the largest
 * contentful paint never waits behind 0.7 MB of data the first view does not
 * need. Urgent callers (the screener, whose grid is that data) skip the idle wait.
 */
export function useAfterFirstPaint(urgent = false, idleTimeoutMs = 1500): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => setReady(true);
    const afterPaint = (): void => {
      // Two frames: the first paint has been committed, not just scheduled.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (urgent) done();
          else if (typeof requestIdleCallback === 'function')
            idle = requestIdleCallback(done, { timeout: idleTimeoutMs });
          else timer = setTimeout(done, 0);
        });
      });
    };
    if (document.readyState === 'complete') afterPaint();
    else window.addEventListener('load', afterPaint, { once: true });
    return () => {
      window.removeEventListener('load', afterPaint);
      cancelAnimationFrame(raf);
      if (idle !== undefined) cancelIdleCallback(idle);
      clearTimeout(timer);
    };
  }, [urgent, idleTimeoutMs]);
  return ready;
}
