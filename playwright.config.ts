import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
