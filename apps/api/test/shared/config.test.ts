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
});
