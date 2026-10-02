import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // Two projects: pure logic and the feed server run in Node; anything that
    // renders runs in jsdom with Testing Library matchers installed.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/{unit,integration,performance,server,api}/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          // Real workspaces over a real universe, driven by simulated typing:
          // allow for coverage instrumentation and parallel workers.
          testTimeout: 20_000,
          include: [
            'tests/components/**/*.test.{ts,tsx}',
            'tests/hooks/**/*.test.{ts,tsx}',
            'tests/stores/**/*.test.{ts,tsx}',
          ],
          setupFiles: ['./tests/setup-dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        // Route segments are thin server wrappers verified by the build and e2e runs.
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/not-found.tsx',
        'src/app/**/error.tsx',
        'src/app/**/global-error.tsx',
        'src/app/**/default.tsx',
        // Canvas/WebGL-backed rendering that jsdom cannot execute.
        'src/components/Chart/chartRenderer.ts',
        'src/components/Chart/volumeProfilePrimitive.ts',
        'src/components/Boot/introCanvas.ts',
        'src/workers/**',
      ],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
});
