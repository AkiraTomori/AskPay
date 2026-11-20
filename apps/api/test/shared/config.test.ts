import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/shared/config.js';

const key = 'ab'.repeat(32);
const checkerKey = 'cd'.repeat(32);
const llm = { LLM_API_KEY: 'k-secret', LLM_MODEL: 'vendor/model:free' };
// The environment without one variable, for the "required" checks.
const without = (env: Record<string, string>, name: string) =>
  Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));
const base = {
  RPC_URL: 'https://api.avax-test.network/ext/bc/C/rpc',
  PROVIDER_PRIVATE_KEY: key,
  CHECKER_PRIVATE_KEY: checkerKey,
  ...llm,
};

describe('loadConfig', () => {
  it('applies the documented defaults and adds the 0x prefix to a bare key', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      priceUnits: 50_000n,
      quoteTtlSeconds: 300,
      databasePath: './data/askpay.sqlite',
      port: 4000,
      providerPrivateKey: `0x${key}`,
    });
  });

  it('refuses any chain other than Fuji, mainnet included', () => {
    expect(() => loadConfig({ ...base, CHAIN_ID: '43114' })).toThrow(/CHAIN_ID/);
    expect(loadConfig({ ...base, CHAIN_ID: '43113' })).toBeTruthy();
  });

  it('names a bad variable but never echoes its value', () => {
    const secret = 'not-a-real-key-but-treat-as-secret';
    let message = '';
    try {
      loadConfig({ ...base, PROVIDER_PRIVATE_KEY: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('PROVIDER_PRIVATE_KEY');
    expect(message).not.toContain(secret);
  });

  it('requires everything a server needs to take money AND settle it', () => {
    expect(() => loadConfig({})).toThrow(/RPC_URL/);
    expect(() => loadConfig(without(base, 'PROVIDER_PRIVATE_KEY'))).toThrow(/PROVIDER_PRIVATE_KEY/);
  });

  it('rejects a zero or non-numeric price', () => {
    expect(() => loadConfig({ ...base, PRICE_UNITS: '0' })).toThrow(/PRICE_UNITS/);
    expect(() => loadConfig({ ...base, PRICE_UNITS: '0.05' })).toThrow(/PRICE_UNITS/);
  });

  describe('checker key', () => {
    it('is required, because a server without it takes money it can never settle', () => {
      expect(() => loadConfig(without(base, 'CHECKER_PRIVATE_KEY'))).toThrow(/CHECKER_PRIVATE_KEY/);
    });

    it('gets the 0x prefix', () => {
      expect(loadConfig(base).checkerPrivateKey).toBe(`0x${checkerKey}`);
    });

    it('refuses the provider key reused as the checker key, in either spelling (T-04)', () => {
      expect(() => loadConfig({ ...base, CHECKER_PRIVATE_KEY: key })).toThrow(
        /CHECKER_PRIVATE_KEY/,
      );
      expect(() => loadConfig({ ...base, CHECKER_PRIVATE_KEY: `0x${key}` })).toThrow(
        /CHECKER_PRIVATE_KEY/,
      );
    });

    it('names the variable but never echoes the key', () => {
      let message = '';
      try {
        loadConfig({ ...base, CHECKER_PRIVATE_KEY: key });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(key);
    });
  });

  describe('log scanning', () => {
    it('defaults to the public Fuji RPC limit of 100 blocks per read and a 24 hour lookback', () => {
      expect(loadConfig(base)).toMatchObject({ logRangeBlocks: 100, scanLookbackBlocks: 43_200 });
    });

    it('can be raised for a better RPC, and refuses nonsense', () => {
      expect(loadConfig({ ...base, LOG_RANGE_BLOCKS: '2000' }).logRangeBlocks).toBe(2000);
      expect(() => loadConfig({ ...base, LOG_RANGE_BLOCKS: '0' })).toThrow(/LOG_RANGE_BLOCKS/);
      expect(() => loadConfig({ ...base, SCAN_LOOKBACK_BLOCKS: 'abc' })).toThrow(
        /SCAN_LOOKBACK_BLOCKS/,
      );
    });
  });

  describe('read endpoint limits', () => {
    it('defaults to 120 reads a minute and no proxy in front of the server', () => {
      expect(loadConfig(base)).toMatchObject({ readRateLimitPerMinute: 120, trustProxyHops: 0 });
    });

    it('can be changed, and refuses nonsense', () => {
      const config = loadConfig({
        ...base,
        READ_RATE_LIMIT_PER_MINUTE: '300',
        TRUST_PROXY_HOPS: '1',
      });
      expect(config).toMatchObject({ readRateLimitPerMinute: 300, trustProxyHops: 1 });
      expect(() => loadConfig({ ...base, READ_RATE_LIMIT_PER_MINUTE: '0' })).toThrow(
        /READ_RATE_LIMIT_PER_MINUTE/,
      );
      expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
      expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: 'many' })).toThrow(/TRUST_PROXY_HOPS/);
    });
  });

  describe('demo fake citation', () => {
    it('is off unless explicitly turned on', () => {
      expect(loadConfig(base).demoFakeCitation).toBe(false);
      expect(loadConfig({ ...base, DEMO_FAKE_CITATION: 'true' }).demoFakeCitation).toBe(true);
      expect(() => loadConfig({ ...base, DEMO_FAKE_CITATION: 'yes' })).toThrow(
        /DEMO_FAKE_CITATION/,
      );
    });
  });

  describe('demo stall', () => {
    it('is off unless explicitly turned on', () => {
      expect(loadConfig(base).demoStall).toBe(false);
      expect(loadConfig({ ...base, DEMO_STALL: 'true' }).demoStall).toBe(true);
      expect(() => loadConfig({ ...base, DEMO_STALL: 'yes' })).toThrow(/DEMO_STALL/);
    });
  });

  describe('LLM settings', () => {
    it('are required: without an LLM every paid question would be refunded', () => {
      expect(() => loadConfig(without(without(base, 'LLM_API_KEY'), 'LLM_MODEL'))).toThrow(
        /LLM_API_KEY/,
      );
    });

    it('build an LLM config, defaulting to OpenRouter with JSON mode', () => {
      const config = loadConfig(base);
      expect(config.llm).toEqual({
        provider: 'openrouter',
        apiKey: 'k-secret',
        model: 'vendor/model:free',
        jsonMode: true,
      });
    });

    it('accept groq and JSON mode off', () => {
      const config = loadConfig({
        ...base,
        LLM_API_KEY: 'k',
        LLM_MODEL: 'm',
        LLM_PROVIDER: 'groq',
        LLM_JSON_MODE: 'false',
      });
      expect(config.llm).toMatchObject({ provider: 'groq', jsonMode: false });
    });

    it('refuse a key without a model and a model without a key, naming only the variable', () => {
      const noModel = without(base, 'LLM_MODEL');
      const noKey = without(base, 'LLM_API_KEY');
      expect(() => loadConfig(noModel)).toThrow(/LLM_MODEL/);
      expect(() => loadConfig(noKey)).toThrow(/LLM_API_KEY/);
      let message = '';
      try {
        loadConfig(noModel);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain('k-secret');
    });

    it('reject an unknown provider', () => {
      expect(() =>
        loadConfig({ ...base, LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_PROVIDER: 'nope' }),
      ).toThrow(/LLM_PROVIDER/);
    });
  });
});
