import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.mjs',
  globalSetup: './test/e2e/build.mjs',
  timeout: 40_000,
  expect: { timeout: 8_000 },
  workers: 2,
  reporter: [['line']],
  use: { headless: true, viewport: { width: 1440, height: 900 }, actionTimeout: 8_000 },
});
