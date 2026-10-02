/** Envelope shared by every `/api/*` response. */
export interface ApiMeta {
  /** ISO-8601 time the response was produced. */
  timestamp: string;
  /** Server time spent producing the payload, measured with performance.now(). */
  executionTimeMs: number;
  requestId: string;
  /** Universe version the data belongs to. */
  version?: string;
  count?: number;
  total?: number;
  limit?: number;
  offset?: number;
  cache?: 'HIT' | 'MISS';
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | { success: true; data: T; meta: ApiMeta; error?: never }
  | { success: false; data: null; meta: ApiMeta; error: ApiErrorBody };
