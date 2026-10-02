import { vi } from 'vitest';

/** The Next.js router as components see it in tests (mocked in setup-dom). */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export const navigation = { pathname: '/' };
