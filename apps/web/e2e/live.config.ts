import { defineConfig, devices } from '@playwright/test';

// Browser checks against a web and an API that are ALREADY running (default :3000 and :4000). It
// starts nothing and builds nothing. Real questions are read through the web's own /api rewrite.
//   E2E_LIVE_API=1 npx playwright test -c e2e/live.config.ts
// Playwright's own Chromium, as in playwright.config.ts: the owner's browsers are never touched.
export default defineConfig({
  testDir: '.',
  testMatch: 'result-live.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  outputDir: '../.playwright/results-live',
  use: {
    baseURL: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000',
    ...devices['Desktop Chrome'],
  },
});
