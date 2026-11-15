import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'node', include: ['{apps/api,packages/*}/test/**/*.test.ts'] },
      },
      {
        plugins: [react()],
        resolve: { alias: { '@': new URL('./apps/web/src', import.meta.url).pathname } },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/test/setup.ts'],
          globals: true,
        },
      },
    ],
  },
});
