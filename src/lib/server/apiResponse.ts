import type { ApiMeta, ApiResponse } from '@/types/api';

/**
 * Builds the shared `ApiResponse<T>` envelope. `executionTimeMs` is a real
 * performance.now() delta from the start of the handler.
 */

let sequence = 0;
const requestId = (): string => `${Date.now().toString(36)}-${(++sequence).toString(36)}`;

export const startTimer = (): number => performance.now();

const elapsed = (started: number): number =>
  Math.round((performance.now() - started) * 1000) / 1000;

export function meta(started: number, extra: Partial<ApiMeta> = {}): ApiMeta {
  return {
    timestamp: new Date().toISOString(),
    executionTimeMs: elapsed(started),
    requestId: requestId(),
    ...extra,
  };
}

export interface OkOptions {
  meta?: Partial<ApiMeta>;
  status?: number;
  headers?: Record<string, string>;
}

export function ok<T>(data: T, started: number, options: OkOptions = {}): Response {
  const body: ApiResponse<T> = { success: true, data, meta: meta(started, options.meta) };
  return Response.json(body, {
    status: options.status ?? 200,
    headers: { 'X-Execution-Time-Ms': String(body.meta.executionTimeMs), ...options.headers },
  });
}

export function fail(
  code: string,
  message: string,
  status: number,
  started: number,
  details?: unknown,
): Response {
  const body: ApiResponse<never> = {
    success: false,
    data: null,
    meta: meta(started),
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Cache headers for data that is fixed for a trading day. */
export const DAILY_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400';
