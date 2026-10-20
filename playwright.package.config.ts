import { defineConfig } from '@playwright/test';
// Smoke test of the packaged app from `npm run package:mac` (#10); not part of test:desktop.
export default defineConfig({
  testDir: './tests/package',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
