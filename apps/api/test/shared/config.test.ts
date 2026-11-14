import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/shared/config.js';

const key = 'ab'.repeat(32);
const base = { RPC_URL: 'https://api.avax-test.network/ext/bc/C/rpc', PROVIDER_PRIVATE_KEY: key };

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

  it('requires the RPC url and the provider key', () => {
    expect(() => loadConfig({})).toThrow(/RPC_URL/);
    expect(() => loadConfig({ RPC_URL: base.RPC_URL })).toThrow(/PROVIDER_PRIVATE_KEY/);
  });

  it('rejects a zero or non-numeric price', () => {
    expect(() => loadConfig({ ...base, PRICE_UNITS: '0' })).toThrow(/PRICE_UNITS/);
    expect(() => loadConfig({ ...base, PRICE_UNITS: '0.05' })).toThrow(/PRICE_UNITS/);
  });

  describe('checker key', () => {
    const checkerKey = 'cd'.repeat(32);

    it('is optional until the pipeline needs it, and gets the 0x prefix', () => {
      expect(loadConfig(base).checkerPrivateKey).toBeUndefined();
      expect(loadConfig({ ...base, CHECKER_PRIVATE_KEY: checkerKey }).checkerPrivateKey).toBe(
        `0x${checkerKey}`,
      );
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

  describe('LLM settings', () => {
    it('are optional until the pipeline needs them', () => {
      expect(loadConfig(base).llm).toBeUndefined();
    });

    it('build an LLM config when the key and model are set, defaulting to OpenRouter with JSON mode', () => {
      const config = loadConfig({
        ...base,
        LLM_API_KEY: 'k-secret',
        LLM_MODEL: 'vendor/model:free',
      });
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
      expect(() => loadConfig({ ...base, LLM_API_KEY: 'k-secret' })).toThrow(/LLM_MODEL/);
      expect(() => loadConfig({ ...base, LLM_MODEL: 'm' })).toThrow(/LLM_API_KEY/);
      let message = '';
      try {
        loadConfig({ ...base, LLM_API_KEY: 'k-secret' });
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
