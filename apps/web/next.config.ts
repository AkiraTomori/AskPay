import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // The monorepo root holds the lockfile; without this Next guesses the workspace root.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
};

export default config;
