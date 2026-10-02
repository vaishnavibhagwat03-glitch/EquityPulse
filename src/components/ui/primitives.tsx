import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { direction, formatPercent, formatSigned } from '@/lib/format';

/** Keyboard key. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line num',
        'bg-surface px-1 text-[10.5px] leading-none text-muted shadow-[0_1px_0_var(--border)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

type Tone = 'neutral' | 'positive' | 'negative' | 'accent' | 'warning' | 'outline';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-active text-ink-2',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  accent: 'bg-accent-soft text-accent',
  warning: 'bg-warning-soft text-warning',
  outline: 'border border-line text-muted',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[10.5px] font-medium tracking-[0.04em] uppercase',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <span aria-hidden className={cn('skeleton block', className)} style={style} />;
}

/** Signed change with direction colour, e.g. +1.42%. */
export function ChangeText({
  value,
  percent = true,
  decimals = 2,
  className,
  arrow = false,
}: {
  value: number | null | undefined;
  percent?: boolean;
  decimals?: number;
  className?: string;
  arrow?: boolean;
}) {
  const dir = direction(value);
  const text = percent
    ? formatPercent(value, { decimals, signed: true })
    : formatSigned(value, decimals);
  return (
    <span
      className={cn(
        'num',
        dir > 0 && 'up',
        dir < 0 && 'down',
        dir === 0 && 'text-muted',
        className,
      )}
    >
      {arrow && dir !== 0 ? <span aria-hidden>{dir > 0 ? '▲ ' : '▼ '}</span> : null}
      {text}
    </span>
  );
}

/** Uppercase micro label. */
export function Label({
  children,
  className,
  as: Tag = 'span',
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'h2' | 'h3' | 'p' | 'dt';
}) {
  return <Tag className={cn('label-caps', className)}>{children}</Tag>;
}

/** Status dot with an optional single ping (no permanent motion). */
export function StatusDot({
  tone,
  ping = false,
  className,
}: {
  tone: 'live' | 'warn' | 'off' | 'idle';
  ping?: boolean;
  className?: string;
}) {
  const color =
    tone === 'live'
      ? 'bg-positive'
      : tone === 'warn'
        ? 'bg-warning'
        : tone === 'off'
          ? 'bg-negative'
          : 'bg-faint';
  return (
    <span className={cn('relative inline-flex h-1.5 w-1.5', className)} aria-hidden>
      {ping ? (
        <span
          key={tone}
          className={cn('absolute inset-0 rounded-full', color)}
          style={{ animation: 'ep-ping 900ms var(--ep-ease-out) 1 both' }}
        />
      ) : null}
      <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', color)} />
    </span>
  );
}

export function Divider({
  className,
  vertical = false,
}: {
  className?: string;
  vertical?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        vertical ? 'mx-2 h-4 w-px self-center bg-line' : 'block h-px w-full bg-line',
        className,
      )}
    />
  );
}
