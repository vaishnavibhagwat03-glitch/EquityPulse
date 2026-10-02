'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useUiStore } from '@/stores/uiStore';

// Overlays are code-split: none of them is needed for first paint.
const CommandPalette = dynamic(() => import('@/components/CommandPalette/CommandPalette'), {
  ssr: false,
});
const HelpDialog = dynamic(() => import('@/components/CommandPalette/HelpDialog'), { ssr: false });
const PerformanceMonitor = dynamic(() => import('@/components/Layout/PerformanceMonitor'), {
  ssr: false,
});

/** App-wide shortcuts and lazily loaded overlays. */
export function GlobalOverlays() {
  const router = useRouter();
  const paletteOpen = useUiStore(s => s.paletteOpen);
  const helpOpen = useUiStore(s => s.helpOpen);
  const perfOpen = useUiStore(s => s.perfOpen);
  const setPalette = useUiStore(s => s.setPalette);
  const setHelp = useUiStore(s => s.setHelp);

  useHotkeys({
    'mod+k': () => setPalette(!useUiStore.getState().paletteOpen),
    '/': () => setPalette(true),
    '?': () => setHelp(true),
    'g m': () => router.push('/'),
    'g s': () => router.push('/screener'),
    'g w': () => router.push('/watchlist'),
    'g h': () => router.push('/heatmap'),
  });

  return (
    <>
      {paletteOpen ? (
        <ErrorBoundary region="Command palette" className="hidden">
          <CommandPalette />
        </ErrorBoundary>
      ) : null}
      {helpOpen ? <HelpDialog /> : null}
      {perfOpen ? <PerformanceMonitor /> : null}
    </>
  );
}
