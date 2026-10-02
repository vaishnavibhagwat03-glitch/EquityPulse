'use client';

import { useSyncExternalStore } from 'react';

/** Subscribes to a media query; `serverValue` is used during SSR and hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    onChange => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const usePrefersReducedMotion = (): boolean =>
  useMediaQuery('(prefers-reduced-motion: reduce)');

/** Breakpoints mirror the layout: rail + grid + context panel ≥ 1280px. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)', true);
export const useIsWide = (): boolean => useMediaQuery('(min-width: 1280px)', true);
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 767px)');
