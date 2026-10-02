import type { PanelState, Preset } from '@/types/filters';

/**
 * Saved screens created through `POST /api/filters/presets`.
 *
 * In-memory and per server instance: this is a demo backend with no database.
 * Saved screens survive for the life of the process (and dev hot reloads); the
 * client also keeps its own copy in localStorage, so nothing is lost on a
 * redeploy. Capped to keep memory bounded.
 */

const LIMIT = 200;
const store = globalThis as unknown as { __equitypulsePresets?: Map<string, Preset> };
const presets = (store.__equitypulsePresets ??= new Map());

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'screen';

export function listUserPresets(): Preset[] {
  return [...presets.values()];
}

export function saveUserPreset(input: {
  name: string;
  description?: string;
  panel: Pick<PanelState, 'values'> & Partial<Omit<PanelState, 'values'>>;
}): Preset {
  if (presets.size >= LIMIT) presets.delete(presets.keys().next().value!);
  const id = `user-${slug(input.name)}-${Date.now().toString(36)}`;
  const preset: Preset = {
    id,
    name: input.name,
    description: input.description ?? 'Saved screen',
    criteria: [],
    panel: input.panel,
    builtIn: false,
    createdAt: new Date().toISOString(),
  };
  presets.set(id, preset);
  return preset;
}
