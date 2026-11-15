import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return (await import('../../next.config')).default;
}

afterEach(() => vi.unstubAllEnvs());

describe('next.config: /api rewrite and proxy timeout (design W2 §9)', () => {
  it('rewrites /api/* to API_ORIGIN', async () => {
    vi.stubEnv('API_ORIGIN', 'http://localhost:4000');
    const config = await loadConfig();
    expect(await config.rewrites?.()).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' },
    ]);
  });

  it('W2-E20: lets the proxy wait longer than the 60 s the server holds POST /api/ask', async () => {
    vi.stubEnv('API_ORIGIN', 'http://localhost:4000');
    const config = await loadConfig();
    // Next 16.4.6 reads this key from `experimental`; at the top level it is silently ignored and
    // the proxy gives up after 30 s.
    expect(config.experimental?.proxyTimeout).toBeGreaterThan(60_000);
    expect(config).not.toHaveProperty('proxyTimeout');
  });

  it('hides the Next dev indicator', async () => {
    vi.stubEnv('API_ORIGIN', 'http://localhost:4000');
    const config = await loadConfig();
    expect(config.devIndicators).toBe(false);
  });

  it('fails loudly without API_ORIGIN instead of pointing at localhost', async () => {
    vi.stubEnv('API_ORIGIN', '');
    await expect(loadConfig()).rejects.toThrow(/API_ORIGIN/);
  });
});
