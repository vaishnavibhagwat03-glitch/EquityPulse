import type { useRouter } from 'next/navigation';
import { feedController } from '@/lib/feed/controller';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';

/** Palette actions. Each is a plain function over the stores and router. */

export interface CommandContext {
  router: ReturnType<typeof useRouter>;
  pathname: string;
}

export interface Command {
  id: string;
  label: string;
  group: 'Navigate' | 'Screener' | 'Appearance' | 'Market feed' | 'Diagnostics' | 'Help';
  keywords?: string;
  shortcut?: string[];
  run(ctx: CommandContext): void;
}

const ui = () => useUiStore.getState();
const filters = () => useFilterStore.getState();

export const COMMANDS: readonly Command[] = [
  {
    id: 'nav-markets',
    label: 'Go to Markets',
    group: 'Navigate',
    shortcut: ['G', 'M'],
    keywords: 'home overview indices',
    run: ({ router }) => router.push('/'),
  },
  {
    id: 'nav-screener',
    label: 'Go to Screener',
    group: 'Navigate',
    shortcut: ['G', 'S'],
    keywords: 'screen filter grid',
    run: ({ router }) => router.push('/screener'),
  },
  {
    id: 'nav-watchlist',
    label: 'Go to Watchlist',
    group: 'Navigate',
    shortcut: ['G', 'W'],
    keywords: 'favourites saved',
    run: ({ router }) => router.push('/watchlist'),
  },
  {
    id: 'toggle-filters',
    label: 'Toggle filter panel',
    group: 'Screener',
    shortcut: ['F'],
    keywords: 'sidebar collapse',
    run: ({ router, pathname }) => {
      if (!pathname.startsWith('/screener')) router.push('/screener');
      ui().toggleFilters();
    },
  },
  {
    id: 'clear-filters',
    label: 'Clear all filters',
    group: 'Screener',
    keywords: 'reset remove conditions',
    run: () => filters().clearAll(),
  },
  {
    id: 'watchlist-only',
    label: 'Screen watchlist only',
    group: 'Screener',
    keywords: 'filter watched',
    run: ({ router, pathname }) => {
      filters().setWatchlistOnly(!filters().watchlistOnly);
      if (!pathname.startsWith('/screener')) router.push('/screener');
    },
  },
  {
    id: 'reset-columns',
    label: 'Reset grid columns',
    group: 'Screener',
    keywords: 'layout pin width',
    run: () => ui().resetColumns(),
  },
  {
    id: 'theme-light',
    label: 'Theme: Light',
    group: 'Appearance',
    keywords: 'appearance mode',
    run: () => ui().setTheme('light'),
  },
  {
    id: 'theme-dark',
    label: 'Theme: Dark',
    group: 'Appearance',
    keywords: 'appearance mode night',
    run: () => ui().setTheme('dark'),
  },
  {
    id: 'theme-system',
    label: 'Theme: Follow system',
    group: 'Appearance',
    keywords: 'appearance auto os',
    run: () => ui().setTheme('system'),
  },
  {
    id: 'feed-drop',
    label: 'Simulate network interruption',
    group: 'Market feed',
    keywords: 'disconnect offline reconnect websocket test',
    run: () => feedController.simulateDrop(),
  },
  {
    id: 'feed-reconnect',
    label: 'Reconnect market feed',
    group: 'Market feed',
    keywords: 'retry websocket',
    run: () => feedController.retryNow(),
  },
  {
    id: 'perf',
    label: 'Performance monitor',
    group: 'Diagnostics',
    keywords: 'fps latency memory vitals',
    run: () => ui().setPerf(!ui().perfOpen),
  },
  {
    id: 'chart-fault',
    label: 'Simulate chart failure',
    group: 'Diagnostics',
    keywords: 'error boundary test crash',
    run: () => ui().setChartFault(true),
  },
  {
    id: 'help',
    label: 'Keyboard shortcuts',
    group: 'Help',
    shortcut: ['?'],
    keywords: 'help keys',
    run: () => ui().setHelp(true),
  },
];
