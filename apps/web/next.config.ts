import type { NextConfig } from 'next';
import path from 'node:path';

// The API lives in apps/api (a separate process); the browser only ever talks to this origin.
// No silent default to localhost: a missing value would point a deployed site at the wrong place.
const apiOrigin = process.env.API_ORIGIN;
if (!apiOrigin) {
  throw new Error(
    'API_ORIGIN is not set. Add it to apps/web/.env.local (e.g. API_ORIGIN=http://localhost:4000).',
  );
}

const config: NextConfig = {
  // Browser tests (playwright.config.ts) build into their own folder so they never touch a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The monorepo root holds the lockfile; without this Next guesses the workspace root.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }],
  // The rewrite proxy cuts a request after 30 s by default, but the server holds POST /api/ask up
  // to 60 s. 75 s = 60 s + margin. In 16.4.6 the key lives under `experimental`; elsewhere Next
  // ignores it silently, which is why a test reads this value back.
  experimental: { proxyTimeout: 75_000 },
  // Hides Next's dev-mode status icon (bottom-left by default). Dev only; it never ships to production.
  devIndicators: false,
};

export default config;
