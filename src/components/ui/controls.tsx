'use client';

import {
  forwardRef,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import { Kbd } from './primitives';

/* -------------------------------------------------------------- Segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Radio group styled as a segmented control; arrow keys move the selection. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
  className,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center rounded-md border border-line bg-bg-sunken p-[2px]',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              'inline-flex items-center justify-center rounded-[4px] num font-medium transition-[background-color,color,box-shadow] duration-150',
              size === 'xs' ? 'h-5 px-1.5 text-[10.5px]' : 'h-6 px-2 text-[11.5px]',
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onChange,
  label,
  className,
  describedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border transition-colors duration-150',
        checked ? 'border-transparent bg-surface-inverse' : 'border-line-strong bg-bg-sunken',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-transform duration-200 ease-out',
          checked ? 'translate-x-[14px] bg-ink-inverse' : 'translate-x-[2px] bg-faint',
        )}
      />
    </button>
  );
}

/* ---------------------------------------------------------------- Checkbox */

export function Checkbox({
  checked,
  onChange,
  children,
  className,
  indeterminate = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
  indeterminate?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm text-ink-2 hover:bg-surface-hover',
        className,
      )}
    >
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          ref={el => {
            if (el) el.indeterminate = indeterminate;
          }}
          onChange={e => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[3px] border border-line-strong bg-surface checked:border-transparent checked:bg-surface-inverse"
        />
        <Icon
          name="check"
          size={12}
          strokeWidth={2}
          className="pointer-events-none absolute top-[1px] left-[1px] text-ink-inverse opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}

/* ------------------------------------------------------------ NumberInput */

/**
 * Numeric text input that commits on Enter or blur. Accepts "20k", "1.5L",
 * "2Cr" and grouping commas, so typing a market cap is natural.
 */
export function parseNumberInput(raw: string): number | undefined {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/₹|%|×|x$/g, '');
  if (!s) return undefined;
  const m = /^(-?\d*\.?\d+)\s*(k|l|lakh|cr|crore|m|b)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  const mult = { k: 1e3, l: 1e5, lakh: 1e5, cr: 1e7, crore: 1e7, m: 1e6, b: 1e9 }[m[2] ?? ''] ?? 1;
  return Number.isFinite(n) ? n * mult : undefined;
}

export function NumberInput({
  value,
  onCommit,
  placeholder,
  label,
  format,
  className,
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  placeholder?: string;
  label: string;
  format?: (value: number) => string;
  className?: string;
}) {
  const display = (v: number | undefined): string =>
    v === undefined ? '' : format ? format(v) : String(Math.round(v * 1000) / 1000);
  // While editing, the field shows the draft; otherwise it always reflects
  // `value` (a preset or "clear all" can change it from outside).
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const shown = focused ? text : display(value);

  // Unparseable input is simply dropped: once blurred the field shows `value` again.
  const commit = (): void => {
    if (text === display(value)) return;
    if (text.trim() === '') {
      onCommit(undefined);
      return;
    }
    const parsed = parseNumberInput(text);
    if (parsed !== undefined) onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onFocus={() => {
        setText(display(value));
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        if (cancelled.current) cancelled.current = false;
        else commit();
      }}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        // Enter commits (via blur); Escape reverts.
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-line bg-surface px-2 num text-xs text-ink',
        'placeholder:text-faint focus:border-accent focus:outline-none',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------ SearchInput */

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    value: string;
    onValueChange: (value: string) => void;
    shortcut?: string;
    containerClassName?: string;
  }
>(function SearchInput(
  { value, onValueChange, shortcut, containerClassName, className, ...rest },
  ref,
) {
  return (
    <div className={cn('relative flex items-center', containerClassName)}>
      <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-muted" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={e => onValueChange(e.target.value)}
        className={cn(
          'h-8 w-full rounded-md border border-line bg-surface pr-16 pl-8 text-sm text-ink',
          'placeholder:text-muted focus:border-accent focus:outline-none',
          '[&::-webkit-search-cancel-button]:appearance-none',
          className,
        )}
        {...rest}
      />
      <div className="absolute right-1.5 flex items-center gap-1">
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange('')}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:bg-surface-active hover:text-ink"
          >
            <Icon name="x" size={12} />
          </button>
        ) : shortcut ? (
          <Kbd>{shortcut}</Kbd>
        ) : null}
      </div>
    </div>
  );
});
