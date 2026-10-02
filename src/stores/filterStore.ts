import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Stock } from '@/types/market';
import type {
  Combinator,
  FilterCategory,
  FilterValue,
  Group,
  PanelState,
  Preset,
} from '@/types/filters';
import type { SortSpec } from '@/lib/filters/sort';
import { EMPTY_PANEL } from '@/lib/filters/panel';
import { panelFromPreset } from '@/lib/filters/presets';
import { describeValue } from '@/lib/filters/panel';
import { FILTER_BY_ID } from '@/lib/filters/definitions';

/**
 * Screener query state: the filter panel, search, sort and saved screens.
 * Pure state — the expression is compiled and evaluated by the filter engine
 * (lib/filterEngine.ts), never inside components.
 */

export const DEFAULT_SORT: SortSpec = { field: 'marketCap', direction: 'desc' };

export interface FilterStoreState {
  panel: PanelState;
  search: string;
  watchlistOnly: boolean;
  sort: SortSpec | null;
  activePresetId: string | null;
  savedPresets: Preset[];

  setValue(id: string, value: FilterValue | undefined): void;
  clearAll(): void;
  setGroupMode(category: FilterCategory, mode: Combinator): void;
  setRootMode(mode: Combinator): void;
  setCustom(group: Group | null): void;
  setSearch(search: string): void;
  setWatchlistOnly(on: boolean): void;
  setSort(sort: SortSpec | null): void;
  /** Header click: descending → ascending → default. */
  cycleSort(field: string): void;
  applyPreset(preset: Preset): void;
  savePreset(name: string, description?: string): Preset;
  deletePreset(id: string): void;
  screenSimilar(stock: Stock): void;
}

const emptyPanel = (): PanelState => structuredClone(EMPTY_PANEL);

export const useFilterStore = create<FilterStoreState>()(
  persist(
    (set, get) => ({
      panel: emptyPanel(),
      search: '',
      watchlistOnly: false,
      sort: DEFAULT_SORT,
      activePresetId: null,
      savedPresets: [],

      setValue(id, value) {
        set(state => {
          const values = { ...state.panel.values };
          if (value === undefined) delete values[id];
          else values[id] = value;
          return { panel: { ...state.panel, values } };
        });
      },
      clearAll() {
        set({ panel: emptyPanel(), activePresetId: null, watchlistOnly: false, search: '' });
      },
      setGroupMode(category, mode) {
        set(state => ({
          panel: { ...state.panel, groupModes: { ...state.panel.groupModes, [category]: mode } },
        }));
      },
      setRootMode(mode) {
        set(state => ({ panel: { ...state.panel, rootMode: mode } }));
      },
      setCustom(group) {
        set(state => ({ panel: { ...state.panel, custom: group } }));
      },
      setSearch(search) {
        set({ search });
      },
      setWatchlistOnly(on) {
        set({ watchlistOnly: on });
      },
      setSort(sort) {
        set({ sort });
      },
      cycleSort(field) {
        const current = get().sort;
        if (!current || current.field !== field) set({ sort: { field, direction: 'desc' } });
        else if (current.direction === 'desc') set({ sort: { field, direction: 'asc' } });
        else set({ sort: DEFAULT_SORT });
      },
      applyPreset(preset) {
        set({ panel: panelFromPreset(preset), activePresetId: preset.id });
      },
      savePreset(name, description) {
        const panel = get().panel;
        const preset: Preset = {
          id: `local-${Date.now().toString(36)}`,
          name: name.trim() || 'Untitled screen',
          description: description?.trim() || 'Saved screen',
          criteria: Object.entries(panel.values).flatMap(([id, value]) => {
            const def = FILTER_BY_ID.get(id);
            return def ? [describeValue(def, value)] : [];
          }),
          panel: structuredClone(panel),
          builtIn: false,
          createdAt: new Date().toISOString(),
        };
        set(state => ({
          savedPresets: [...state.savedPresets, preset],
          activePresetId: preset.id,
        }));
        return preset;
      },
      deletePreset(id) {
        set(state => ({
          savedPresets: state.savedPresets.filter(p => p.id !== id),
          activePresetId: state.activePresetId === id ? null : state.activePresetId,
        }));
      },
      screenSimilar(stock) {
        const values: Record<string, FilterValue> = {
          sector: { type: 'multiselect', values: [stock.sector] },
          marketCapCategory: { type: 'multiselect', values: [stock.marketCapCategory] },
        };
        if (stock.pe !== null) {
          values.pe = {
            type: 'range',
            min: Math.floor(stock.pe * 0.6),
            max: Math.ceil(stock.pe * 1.4),
          };
        }
        values.roe = { type: 'range', min: Math.floor(stock.roe - 6) };
        set({
          panel: { ...emptyPanel(), values },
          activePresetId: null,
          search: '',
          watchlistOnly: false,
        });
      },
    }),
    {
      name: 'ep:screener',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: s => ({
        panel: s.panel,
        sort: s.sort,
        watchlistOnly: s.watchlistOnly,
        activePresetId: s.activePresetId,
        savedPresets: s.savedPresets,
      }),
    },
  ),
);
