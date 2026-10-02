import { BUILT_IN_PRESETS } from '@/lib/filters/presets';
import { describeValue } from '@/lib/filters/panel';
import { FILTER_BY_ID } from '@/lib/filters/definitions';
import { fail, ok, startTimer } from '@/lib/server/apiResponse';
import { listUserPresets, saveUserPreset } from '@/lib/server/presetStore';
import { panelIssues, presetInputSchema, zodIssues } from '@/lib/server/validation';

/** GET /api/filters/presets — built-in screens plus screens saved on this server. */
export function GET(): Response {
  const started = startTimer();
  const presets = [...BUILT_IN_PRESETS, ...listUserPresets()];
  return ok(presets, started, { meta: { count: presets.length } });
}

/**
 * POST /api/filters/presets — save a screen.
 * Body: { name, description?, panel: { values, groupModes?, rootMode?, custom? } }
 */
export async function POST(request: Request): Promise<Response> {
  const started = startTimer();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('BAD_JSON', 'Request body must be valid JSON', 400, started);
  }

  const parsed = presetInputSchema.safeParse(body);
  if (!parsed.success)
    return fail('VALIDATION_FAILED', 'Invalid preset', 422, started, zodIssues(parsed.error));

  const issues = panelIssues({
    values: parsed.data.panel.values,
    custom: parsed.data.panel.custom ?? null,
  });
  if (issues.length) return fail('VALIDATION_FAILED', 'Invalid preset', 422, started, issues);

  const preset = saveUserPreset({
    name: parsed.data.name,
    description: parsed.data.description,
    panel: {
      values: parsed.data.panel.values,
      ...(parsed.data.panel.rootMode ? { rootMode: parsed.data.panel.rootMode } : {}),
      ...(parsed.data.panel.custom ? { custom: parsed.data.panel.custom } : {}),
    },
  });
  // Criteria are generated from the values so saved screens read like built-ins.
  preset.criteria = Object.entries(preset.panel.values).map(([id, value]) => {
    const def = FILTER_BY_ID.get(id);
    return def ? describeValue(def, value) : id;
  });
  return ok(preset, started, { status: 201 });
}
