'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const noSubscription = (): (() => void) => () => {};

/** `document.body` once on the client; null during SSR and hydration. */
function usePortalTarget(): HTMLElement | null {
  return useSyncExternalStore(
    noSubscription,
    () => document.body,
    () => null,
  );
}

/** Keeps Tab / Shift+Tab inside `container` and restores focus on unmount. */
function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  initial?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = container.current;
    const first = initial?.current ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        el => el.offsetParent !== null,
      );
      if (!items.length) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, container, initial]);
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  /** Where the panel sits: centred, or near the top like a command palette. */
  placement?: 'center' | 'top';
  initialFocus?: RefObject<HTMLElement | null>;
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  children,
  className,
  placement = 'center',
  initialFocus,
}: DialogProps) {
  const target = usePortalTarget();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open, initialFocus);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const root = document.getElementById('app-root');
    root?.setAttribute('inert', '');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      root?.removeAttribute('inert');
    };
  }, [open, onClose]);

  if (!open || !target) return null;
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center px-4',
        placement === 'top' ? 'items-start pt-[12vh]' : 'items-center',
      )}
    >
      <div
        className="fade-enter absolute inset-0 bg-[rgba(14,14,13,0.28)] backdrop-blur-[1.5px] dark:bg-[rgba(0,0,0,0.55)]"
        onMouseDown={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        className={cn(
          'relative w-full rounded-lg border border-line bg-surface shadow-lg outline-none',
          className,
        )}
        style={{ animation: 'ep-scale-in 140ms var(--ep-ease-out) both' }}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    target,
  );
}

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
  label?: string;
  width?: number;
}

/** Anchored panel; flips above the trigger when there is no room below. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'start',
  className,
  label,
  width = 260,
}: PopoverProps) {
  const target = usePortalTarget();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const height = panel.current?.offsetHeight ?? 240;
      const below = a.bottom + 6 + height < window.innerHeight;
      const top = below ? a.bottom + 6 : Math.max(8, a.top - 6 - height);
      let left = align === 'start' ? a.left : a.right - width;
      left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
      setPos({
        top,
        left,
        origin: `${align === 'start' ? 'left' : 'right'} ${below ? 'top' : 'bottom'}`,
      });
    };
    place();
    // Second pass once the panel has its real height.
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const t = event.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open || !target) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={cn('fixed z-40 rounded-lg border border-line bg-surface p-1 shadow-lg', className)}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        transformOrigin: pos?.origin,
        animation: 'ep-scale-in 140ms var(--ep-ease-out) both',
      }}
    >
      {children}
    </div>,
    target,
  );
}

export function Drawer({
  open,
  onClose,
  side = 'left',
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const target = usePortalTarget();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !target) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="fade-enter absolute inset-0 bg-[rgba(14,14,13,0.3)] dark:bg-[rgba(0,0,0,0.55)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'absolute top-0 bottom-0 flex w-[min(360px,92vw)] flex-col bg-surface shadow-lg outline-none',
          side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line',
          className,
        )}
        style={{
          animation: `${side === 'left' ? 'ep-drawer-left' : 'ep-drawer-right'} 280ms var(--ep-ease-drawer) both`,
        }}
        tabIndex={-1}
      >
        {children}
      </div>
      <style>{`@keyframes ep-drawer-left{from{transform:translateX(-100%)}to{transform:translateX(0)}}@keyframes ep-drawer-right{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>,
    target,
  );
}
