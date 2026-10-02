'use client';

import { useSyncExternalStore } from 'react';
import { formatTime } from '@/lib/format';

/** One shared 1 Hz tick for every clock on the page. */
function subscribeToSeconds(onTick: () => void): () => void {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
// Whole seconds, so repeated reads within a tick return the same snapshot.
const currentSecond = (): number => Math.floor(Date.now() / 1000) * 1000;
const noTimeOnServer = (): null => null;

/** IST wall clock. Isolated so its 1 Hz re-render touches only this text. */
export function MarketClock({ className }: { className?: string }) {
  const now = useSyncExternalStore(subscribeToSeconds, currentSecond, noTimeOnServer);
  return (
    <time
      className={className}
      dateTime={now ? new Date(now).toISOString() : undefined}
      suppressHydrationWarning
    >
      <span className="num">{now ? formatTime(now) : '--:--:--'}</span>
      <span className="ml-1 text-[10px] tracking-[0.08em] text-muted">IST</span>
    </time>
  );
}
