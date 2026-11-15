import { defineConfig, devices } from '@playwright/test';

// Browser tests for what jsdom cannot show (the real Next router, the head, real CSS).
// Playwright's own Chromium is installed inside the repo (`npm run e2e:install`); the owner's
// browsers are never touched. The app is a production build in its own folder on its own port, so
// a `next dev` already running on :3000 is not disturbed. The API is never started: tests answer
// /api/* in the browser (`page.route`), so nothing here reaches a server, the chain or a wallet.
const PORT = 3100;
const env = { API_ORIGIN: 'http://127.0.0.1:4999', NEXT_DIST_DIR: '.next-e2e' };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  outputDir: './.playwright/results',
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    env,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
