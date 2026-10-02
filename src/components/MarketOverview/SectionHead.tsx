import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { emergeStyle } from './emerge';

/**
 * A numbered strip naming one step of the page's narrative
 * (01 Market → 02 Signal → 03 Screen → 04 Analyze → 05 Discover).
 */
export function SectionHead({
  step,
  title,
  id,
  anchor,
  emerge,
  className,
  children,
}: {
  step: string;
  title: string;
  /** The heading's id (for aria-labelledby). */
  id?: string;
  /** In-page link target, e.g. "Explore markets" → #signal. */
  anchor?: string;
  /** Present for full-width strips that emerge on their own. */
  emerge?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      id={anchor}
      data-emerge={emerge === undefined ? undefined : ''}
      style={emerge === undefined ? undefined : emergeStyle(emerge)}
      className={cn('flex h-9 min-w-0 items-center gap-2.5 bg-bg px-4', className)}
    >
      <span className="num text-[10.5px] text-faint">{step}</span>
      <h2
        id={id}
        className="text-[10.5px] font-semibold tracking-[0.16em] whitespace-nowrap text-ink uppercase"
      >
        {title}
      </h2>
      {children ? (
        <div className="ml-auto flex min-w-0 items-center gap-3 truncate num text-[10.5px] tracking-[0.04em] text-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}
