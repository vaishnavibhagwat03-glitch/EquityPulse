'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { navigateWithTransition } from '@/lib/transitions';
import { useUiStore } from '@/stores/uiStore';

/**
 * Opens the screener from the market grid: optionally prepares the screen
 * (a preset, a sector), then navigates inside a view transition so the grid
 * becomes the screener rather than being replaced by it.
 */
export function useOpenScreener(): (prepare?: () => void) => void {
  const router = useRouter();
  return useCallback(
    (prepare?: () => void) => {
      prepare?.();
      useUiStore.getState().markEnteredFromMarket();
      navigateWithTransition(() => router.push('/screener'));
    },
    [router],
  );
}
