import type { FilterNode } from '@/types/filters';
import { FilterEngine } from '@/lib/filterEngine';
import { buildColumnStore, type ColumnStore } from '@/lib/filters/columnStore';
import { EMPTY_PANEL, expressionToText, panelToExpression } from '@/lib/filters/panel';
import { fail, ok, startTimer } from '@/lib/server/apiResponse';
import { getMarketModel } from '@/lib/server/marketData';
import {
  expressionIssues,
  panelIssues,
  screenRequestSchema,
  zodIssues,
} from '@/lib/server/validation';

/**
 * POST /api/screen — run a screen server-side with the same engine the client
 * uses. Body: { expression? | panel?, search?, sort?, limit? }.
 * Returns the match count, the first `limit` matches and the engine's timings.
 */

const engineCache = globalThis as unknown as {
  __equitypulseEngine?: { version: string; engine: FilterEngine };
};

function engineFor(version: string, build: () => ColumnStore): FilterEngine {
  const cached = engineCache.__equitypulseEngine;
  if (cached?.version === version) return cached.engine;
  const engine = new FilterEngine(build());
  engineCache.__equitypulseEngine = { version, engine };
  return engine;
}

export async function POST(request: Request): Promise<Response> {
  const started = startTimer();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('BAD_JSON', 'Request body must be valid JSON', 400, started);
  }
  const parsed = screenRequestSchema.safeParse(body);
  if (!parsed.success)
    return fail('VALIDATION_FAILED', 'Invalid screen', 422, started, zodIssues(parsed.error));

  const { panel, expression, search, sort, limit = 50 } = parsed.data;
  let node: FilterNode | null = expression ?? null;
  if (panel) {
    const issues = panelIssues({ values: panel.values, custom: panel.custom ?? null });
    if (issues.length) return fail('VALIDATION_FAILED', 'Invalid panel', 422, started, issues);
    node = panelToExpression(
      {
        values: panel.values,
        groupModes: { ...EMPTY_PANEL.groupModes, ...panel.groupModes },
        rootMode: panel.rootMode ?? 'AND',
        custom: panel.custom ?? null,
      },
      { search },
    );
  } else if (node) {
    const issues = expressionIssues(node);
    if (issues.length) return fail('VALIDATION_FAILED', 'Invalid expression', 422, started, issues);
  }

  const model = getMarketModel();
  const engine = engineFor(model.meta.version, () =>
    buildColumnStore(model.stocks, model.meta.version),
  );
  const result = engine.screen(node, { sort: sort ?? { field: 'marketCap', direction: 'desc' } });
  const matches = Array.from(result.indices.subarray(0, limit), i => {
    const s = model.stocks[i]!;
    return {
      symbol: s.symbol,
      name: s.name,
      price: s.price,
      changePercent: s.changePercent,
      marketCap: s.marketCap,
    };
  });

  return ok({ expression: expressionToText(node), stats: result.stats, matches }, started, {
    meta: { version: model.meta.version, count: matches.length, total: result.stats.matched },
  });
}
