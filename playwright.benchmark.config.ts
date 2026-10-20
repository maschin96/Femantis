import { defineConfig } from '@playwright/test';
// Viewer benchmark (#8): separate from the regression suite, measures instead of asserting.
export default defineConfig({
  testDir: './tests/benchmark',
  testMatch: '*.bench.ts',
  workers: 1,
  reporter: 'list',
});
