'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * A number that glides to its new value instead of snapping.
 *
 * The tween writes `textContent` directly from requestAnimationFrame: React
 * renders the element once and never re-renders it per frame. Short (~450 ms)
 * and skipped entirely under reduced motion or in a hidden tab, so a 1 Hz
 * feed never leaves a value lagging behind the market.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 450,
  className,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  // React owns the initial text only; later values are written by the tween.
  const [initial] = useState(() => format(value));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    const to = value;
    const instant =
      from === to ||
      !Number.isFinite(from) ||
      document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant) {
      shown.current = to;
      el.textContent = format(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (): void => {
      // One clock for start and progress (a frame's timestamp can precede
      // `start`), clamped: an ease must never extrapolate past its ends.
      const p = Math.min(1, Math.max(0, (performance.now() - start) / duration));
      const eased = 1 - (1 - p) ** 3;
      shown.current = from + (to - from) * eased;
      el.textContent = format(p === 1 ? to : shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, format, duration]);

  return (
    <span ref={ref} className={cn('num', className)}>
      {initial}
    </span>
  );
}
