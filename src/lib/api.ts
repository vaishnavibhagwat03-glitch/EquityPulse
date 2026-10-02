import type { ApiMeta, ApiResponse } from '@/types/api';
import type {
  Candle,
  Fundamentals,
  HistoryInterval,
  IndexSnapshot,
  MarketOverview,
  SectorSummary,
  Stock,
} from '@/types/market';
import type { PanelState, Preset } from '@/types/filters';
import type { CompactUniverse } from './universeCodec';

/**
 * Client API layer. Every call goes through `request`, which unwraps the
 * shared ApiResponse envelope and turns failures into a typed ApiError —
 * components never see raw fetch responses.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('Network unavailable', 'NETWORK', 0);
  }
  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Unexpected response (${response.status})`, 'BAD_RESPONSE', response.status);
  }
  if (!body.success) {
    throw new ApiError(body.error.message, body.error.code, response.status, body.error.details);
  }
  return { data: body.data, meta: body.meta };
}

export interface Peer {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  marketCap: number;
  pe: number | null;
  roe: number;
}

export interface ScreenResponse {
  expression: string;
  stats: { matched: number; total: number; timings: { totalMs: number } };
  matches: Pick<Stock, 'symbol' | 'name' | 'price' | 'changePercent' | 'marketCap'>[];
}

const sym = (symbol: string): string => encodeURIComponent(symbol);

export const api = {
  universe: (signal?: AbortSignal) =>
    request<CompactUniverse>('/api/stocks?format=compact', { signal }),
  stock: (symbol: string, signal?: AbortSignal) =>
    request<{ stock: Stock; peers: Peer[] }>(`/api/stocks/${sym(symbol)}`, { signal }),
  history: (symbol: string, interval: HistoryInterval, limit?: number, signal?: AbortSignal) =>
    request<{ symbol: string; interval: HistoryInterval; candles: Candle[] }>(
      `/api/stocks/${sym(symbol)}/history?interval=${interval}${limit ? `&limit=${limit}` : ''}`,
      { signal },
    ),
  fundamentals: (symbol: string, signal?: AbortSignal) =>
    request<Fundamentals>(`/api/stocks/${sym(symbol)}/fundamentals`, { signal }),
  presets: (signal?: AbortSignal) => request<Preset[]>('/api/filters/presets', { signal }),
  savePreset: (input: {
    name: string;
    description?: string;
    panel: Partial<PanelState> & Pick<PanelState, 'values'>;
  }) =>
    request<Preset>('/api/filters/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  sectors: (signal?: AbortSignal) => request<SectorSummary[]>('/api/sectors', { signal }),
  indices: (signal?: AbortSignal) => request<IndexSnapshot[]>('/api/indices', { signal }),
  market: (signal?: AbortSignal) => request<MarketOverview>('/api/market', { signal }),
};

export const queryKeys = {
  universe: ['universe'] as const,
  stock: (symbol: string) => ['stock', symbol] as const,
  history: (symbol: string, interval: HistoryInterval) => ['history', symbol, interval] as const,
  fundamentals: (symbol: string) => ['fundamentals', symbol] as const,
  presets: ['presets'] as const,
  indices: ['indices'] as const,
  market: ['market'] as const,
};
