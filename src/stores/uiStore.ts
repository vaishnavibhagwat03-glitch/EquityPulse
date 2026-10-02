import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ThemePreference } from '@/lib/theme';

/** Interface state: panels, overlays, theme, grid layout. */

export interface ColumnLayout {
  visibility: Record<string, boolean>;
  pinning: { left: string[]; right: string[] };
  sizing: Record<string, number>;
}

export const DEFAULT_COLUMNS: ColumnLayout = {
  visibility: {},
  pinning: { left: ['symbol'], right: [] },
  sizing: {},
};

export interface UiState {
  theme: ThemePreference;
  filtersCollapsed: boolean;
  contextOpen: boolean;
  mobileFiltersOpen: boolean;
  selectedSymbol: string | null;
  paletteOpen: boolean;
  helpOpen: boolean;
  perfOpen: boolean;
  /** Fault injection for the chart error boundary (palette → "Simulate chart failure"). */
  chartFault: boolean;
  columns: ColumnLayout;
  /** Set when the screener is entered from the market grid, for its entrance. */
  enteredFromMarket: number | null;
  /** Recently opened securities, most recent first. */
  recent: string[];

  setTheme(theme: ThemePreference): void;
  toggleFilters(force?: boolean): void;
  toggleContext(force?: boolean): void;
  setMobileFilters(open: boolean): void;
  select(symbol: string | null): void;
  setPalette(open: boolean): void;
  setHelp(open: boolean): void;
  setPerf(open: boolean): void;
  setChartFault(on: boolean): void;
  setColumns(update: (layout: ColumnLayout) => ColumnLayout): void;
  resetColumns(): void;
  markEnteredFromMarket(): void;
  pushRecent(symbol: string): void;
}

export const useUiStore = create<UiState>()(
  persist(
    set => ({
      theme: 'light',
      filtersCollapsed: false,
      contextOpen: true,
      mobileFiltersOpen: false,
      selectedSymbol: null,
      paletteOpen: false,
      helpOpen: false,
      perfOpen: false,
      chartFault: false,
      columns: DEFAULT_COLUMNS,
      enteredFromMarket: null,
      recent: [],

      setTheme: theme => set({ theme }),
      toggleFilters: force => set(s => ({ filtersCollapsed: force ?? !s.filtersCollapsed })),
      toggleContext: force => set(s => ({ contextOpen: force ?? !s.contextOpen })),
      setMobileFilters: open => set({ mobileFiltersOpen: open }),
      select: symbol => set({ selectedSymbol: symbol }),
      setPalette: open => set({ paletteOpen: open }),
      setHelp: open => set({ helpOpen: open }),
      setPerf: open => set({ perfOpen: open }),
      setChartFault: on => set({ chartFault: on }),
      setColumns: update => set(s => ({ columns: update(s.columns) })),
      resetColumns: () => set({ columns: DEFAULT_COLUMNS }),
      markEnteredFromMarket: () => set({ enteredFromMarket: Date.now() }),
      pushRecent: symbol =>
        set(s => ({ recent: [symbol, ...s.recent.filter(r => r !== symbol)].slice(0, 6) })),
    }),
    {
      name: 'ep:ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: s => ({
        theme: s.theme,
        filtersCollapsed: s.filtersCollapsed,
        contextOpen: s.contextOpen,
        columns: s.columns,
        perfOpen: s.perfOpen,
        recent: s.recent,
      }),
    },
  ),
);
