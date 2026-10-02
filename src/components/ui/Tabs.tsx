'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

/** WAI-ARIA tabs: arrow keys move between tabs, Home/End jump. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    items.findIndex(i => i.id === value),
  );

  const onKeyDown = (event: KeyboardEvent): void => {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(items[next]!.id);
    refs.current[next]?.focus();
  };

  const active = items[index]!;
  return (
    <div className={className}>
      {/* Scrolls sideways on narrow screens; the rule is an inset shadow so the
          scroll container cannot clip the active underline. */}
      <div
        role="tablist"
        aria-label={label}
        className="flex [scrollbar-width:none] gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)] sm:gap-1 [&::-webkit-scrollbar]:hidden"
        onKeyDown={onKeyDown}
      >
        {items.map((item, i) => {
          const selected = i === index;
          return (
            <button
              key={item.id}
              ref={el => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                'relative h-9 shrink-0 px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 sm:px-3',
                selected ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {item.label}
              <span
                aria-hidden
                className={cn(
                  'absolute right-2.5 bottom-0 left-2.5 h-[1.5px] bg-ink transition-[opacity,transform] duration-200 ease-out sm:right-3 sm:left-3',
                  selected ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0',
                )}
              />
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${active.id}`}
        aria-labelledby={`${base}-tab-${active.id}`}
        tabIndex={0}
        className="outline-none"
        key={active.id}
        style={{ animation: 'ep-fade-in 180ms var(--ep-ease-out) both' }}
      >
        {active.content}
      </div>
    </div>
  );
}
