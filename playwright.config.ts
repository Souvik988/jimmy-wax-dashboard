import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // The local dev stack runs on a small machine next to Docker; allow slow first renders before an assertion gives up.
  expect: { timeout: 20_000 },
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3200', headless: true },
  reporter: [['list']],
});
