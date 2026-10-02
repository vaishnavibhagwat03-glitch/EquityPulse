'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';
import { feedController } from '@/lib/feed/controller';
import { formatInteger, formatTime } from '@/lib/format';
import { useFeedStore, type FeedStatus } from '@/stores/feedStore';
import { useStockStore } from '@/stores/stockStore';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/overlays';
import { StatusDot } from '@/components/ui/primitives';

const LABEL: Record<FeedStatus, string> = {
  idle: 'IDLE',
  connecting: 'CONNECTING',
  live: 'LIVE',
  reconnecting: 'RECONNECTING',
  offline: 'OFFLINE',
};

const TONE: Record<FeedStatus, 'live' | 'warn' | 'off' | 'idle'> = {
  idle: 'idle',
  connecting: 'warn',
  live: 'live',
  reconnecting: 'warn',
  offline: 'off',
};

const tickQuarterSeconds = (onTick: () => void): (() => void) => {
  const id = setInterval(onTick, 250);
  return () => clearInterval(id);
};
const noTicks = (): (() => void) => () => {};
// Quantised so repeated reads within a tick return the same snapshot.
const quarterSecond = (): number => Math.floor(Date.now() / 250) * 250;

/**
 * Seconds until the next reconnect attempt, ticking down. The clock is read
 * at render, so a countdown that starts long after mount is right from its
 * first frame (a clock held in state would be as old as the component).
 */
function useCountdown(target: number | null): number | null {
  const now = useSyncExternalStore(target ? tickQuarterSeconds : noTicks, quarterSecond, () => 0);
  return target ? Math.max(0, Math.ceil((target - now) / 1000)) : null;
}

export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const status = useFeedStore(s => s.status);
  const attempt = useFeedStore(s => s.attempt);
  const nextRetryAt = useFeedStore(s => s.nextRetryAt);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const seconds = useCountdown(status === 'reconnecting' ? nextRetryAt : null);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Market feed ${LABEL[status].toLowerCase()}. Show connection details`}
        className={cn(
          'inline-flex h-7 tap-target press items-center justify-center gap-2 rounded-md border px-2.5 transition-colors duration-150 max-sm:min-w-7 max-sm:px-0',
          status === 'offline'
            ? 'border-negative/40 bg-negative-soft'
            : 'border-line bg-surface hover:border-line-strong',
        )}
      >
        <StatusDot tone={TONE[status]} ping={status === 'live'} />
        {/* Phones show the dot alone; the state stays in the accessible name. */}
        <span
          className={cn(
            'num text-[10.5px] font-medium tracking-[0.08em] max-sm:sr-only',
            status === 'offline' ? 'down' : 'text-ink-2',
          )}
        >
          {LABEL[status]}
          {!compact && status === 'reconnecting' && seconds !== null ? ` · ${seconds}s` : ''}
          {!compact && status === 'reconnecting' && attempt > 1 ? ` · #${attempt}` : ''}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {status === 'live'
          ? 'Market feed connected'
          : status === 'offline'
            ? 'Market feed offline'
            : ''}
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        width={300}
        label="Market feed details"
      >
        <ConnectionDetails onAction={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-xs text-ink">{value}</span>
    </div>
  );
}

function ConnectionDetails({ onAction }: { onAction: () => void }) {
  const status = useFeedStore(s => s.status);
  const transport = useFeedStore(s => s.transport);
  const rtt = useFeedStore(s => s.rttMs);
  const tps = useFeedStore(s => s.ticksPerSecond);
  const last = useFeedStore(s => s.lastMessageAt);
  const version = useFeedStore(s => s.universeVersion);
  const instruments = useStockStore(s => s.quotes.size);
  const metrics = feedController.metrics;

  return (
    <div className="p-2">
      <p className="mb-2 label-caps">Market feed</p>
      <Row label="Status" value={LABEL[status]} />
      <Row
        label="Transport"
        value={
          transport === 'ws'
            ? 'WebSocket server'
            : transport === 'worker'
              ? 'In-browser engine (worker)'
              : '—'
        }
      />
      <Row label="Instruments streaming" value={formatInteger(instruments)} />
      <Row label="Updates / second" value={formatInteger(tps)} />
      <Row label="Round trip" value={rtt === null ? '—' : `${rtt} ms`} />
      <Row label="Last message" value={last ? `${formatTime(last)} IST` : '—'} />
      <Row label="Sequence gaps resynced" value={formatInteger(metrics?.gaps ?? 0)} />
      <Row label="Reconnects" value={formatInteger(metrics?.reconnects ?? 0)} />
      {version ? (
        <p className="mt-1 truncate num text-[10.5px] text-muted">universe {version}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          onClick={() => {
            feedController.simulateDrop();
            onAction();
          }}
          disabled={status !== 'live'}
        >
          Simulate drop
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="flex-1"
          icon="refresh"
          onClick={() => {
            feedController.retryNow();
            onAction();
          }}
        >
          Reconnect
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-4 text-muted">
        Prices are simulated. Existing data is kept on screen while the feed reconnects.
      </p>
    </div>
  );
}
