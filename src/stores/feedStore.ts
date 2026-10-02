import { create } from 'zustand';
import type { LiveMarket, TransportKind } from '@/lib/feed/protocol';

/**
 * Connection state and whole-market aggregates from the feed.
 * Kept apart from the quote store so the ~1 Hz market updates and status
 * changes never touch the quote subscribers.
 */

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface FeedState {
  status: FeedStatus;
  transport: TransportKind | null;
  attempt: number;
  nextRetryAt: number | null;
  /** True once the first snapshot has been applied this session. */
  synced: boolean;
  universeVersion: string | null;
  lastMessageAt: number | null;
  rttMs: number | null;
  ticksPerSecond: number;
  market: LiveMarket | null;
  marketTs: number | null;

  setStatus(status: FeedStatus, extra?: Partial<Pick<FeedState, 'attempt' | 'nextRetryAt'>>): void;
  patch(partial: Partial<Omit<FeedState, 'setStatus' | 'patch' | 'setMarket'>>): void;
  setMarket(market: LiveMarket, ts: number): void;
}

export const useFeedStore = create<FeedState>()(set => ({
  status: 'idle',
  transport: null,
  attempt: 0,
  nextRetryAt: null,
  synced: false,
  universeVersion: null,
  lastMessageAt: null,
  rttMs: null,
  ticksPerSecond: 0,
  market: null,
  marketTs: null,

  setStatus(status, extra = {}) {
    set({ status, attempt: extra.attempt ?? 0, nextRetryAt: extra.nextRetryAt ?? null });
  },
  patch(partial) {
    set(partial);
  },
  setMarket(market, ts) {
    set({ market, marketTs: ts });
  },
}));
