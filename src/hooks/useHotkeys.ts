'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Keyboard shortcuts.
 *
 * Bindings: `mod+k` (⌘ on macOS, Ctrl elsewhere), plain keys like `/` or `?`,
 * and two-key sequences like `g s`. Plain-key bindings are ignored while the
 * user is typing in an input, textarea or contenteditable; `mod+…` bindings
 * fire everywhere.
 */

export type HotkeyHandler = (event: KeyboardEvent) => void;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

function matches(binding: string, event: KeyboardEvent): boolean {
  const parts = binding.toLowerCase().split('+');
  const key = parts.pop()!;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const mod = event.metaKey || event.ctrlKey;
  if (wantMod !== mod || wantAlt !== event.altKey) return false;
  // `?` and `/` arrive with or without Shift depending on layout; only check
  // Shift when the binding asks for it.
  if (wantShift && !event.shiftKey) return false;
  return event.key.toLowerCase() === key;
}

export function useHotkeys(bindings: Record<string, HotkeyHandler>, enabled = true): void {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const typing = isTypingTarget(event.target);
      const entries = Object.entries(ref.current);

      if (pending) {
        const seq = `${pending} ${event.key.toLowerCase()}`;
        pending = null;
        if (pendingTimer) clearTimeout(pendingTimer);
        const handler = ref.current[seq];
        if (handler && !typing) {
          event.preventDefault();
          handler(event);
          return;
        }
      }

      for (const [binding, handler] of entries) {
        if (binding.includes(' ')) continue;
        const isModBinding = binding.includes('mod+');
        if (typing && !isModBinding) continue;
        if (matches(binding, event)) {
          event.preventDefault();
          handler(event);
          return;
        }
      }

      // Start of a sequence such as "g s".
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (entries.some(([b]) => b.startsWith(`${key} `))) {
          pending = key;
          pendingTimer = setTimeout(() => (pending = null), 900);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [enabled]);
}

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const noSubscription = (): (() => void) => () => {};

/**
 * The modifier key's label: "⌘" on Apple platforms, "Ctrl" elsewhere. The
 * server (and hydration) render "Ctrl"; the client corrects it in the same
 * commit, without an effect-and-setState round trip.
 */
export function useModKey(): string {
  return useSyncExternalStore(
    noSubscription,
    () => (isMac() ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}
