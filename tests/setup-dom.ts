import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { navigation, router } from './helpers/router';

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/**
 * jsdom lacks a few browser APIs the app relies on. These stand-ins are
 * deliberately minimal: tests that care about a behaviour (a media query
 * matching, an element having a size) set it up explicitly.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Object.values(router).forEach(fn => fn.mockClear());
  navigation.pathname = '/';
  delete document.documentElement.dataset.intro;
});

// A 1440 px desktop: width queries are evaluated against it; preference
// queries (reduced motion, dark scheme) are false unless a test overrides them.
Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
export function evaluateMediaQuery(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (!min && !max) return false;
  return (
    (!min || window.innerWidth >= Number(min[1])) && (!max || window.innerWidth <= Number(max[1]))
  );
}
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: evaluateMediaQuery(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

// jsdom implements neither layout scrolling nor canvas.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => null,
) as unknown as HTMLCanvasElement['getContext'];
