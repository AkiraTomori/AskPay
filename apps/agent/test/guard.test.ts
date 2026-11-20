import { fujiDeployment } from '@askpay/shared/abi';
import { describe, expect, it } from 'vitest';
import { checkQuote } from '../src/guard.js';
import { NOW_MS, quote } from './harness.js';

const nowSeconds = NOW_MS / 1000;
const valid = (seconds: number) => String(nowSeconds + seconds);

describe('checkQuote', () => {
  it('accepts a quote for the real escrow and token (lowercase vs checksummed addresses)', () => {
    expect(checkQuote(quote(), fujiDeployment, nowSeconds)).toEqual({ ok: true });
  });

  it('accepts validBefore of exactly one hour', () => {
    const q = quote({ extra: { ...quote().accepts[0]?.extra, validBefore: valid(3600) } });
    expect(checkQuote(q, fujiDeployment, nowSeconds).ok).toBe(true);
  });

  const stranger = `0x${'ab'.repeat(20)}`;
  const baseExtra = quote().accepts[0]?.extra;

  it.each([
    ['payTo is another address', { payTo: stranger }],
    ['asset is another token', { asset: stranger }],
    ['network is not Fuji', { network: 'eip155:43114' }],
    ['scheme is not escrow', { scheme: 'exact' }],
    ['amount is not an integer', { amount: '0.05' }],
    ['amount is empty', { amount: '' }],
    ['amount is zero', { amount: '0' }],
    ['validBefore has passed', { extra: { ...baseExtra, validBefore: valid(-1) } }],
    ['validBefore is now', { extra: { ...baseExtra, validBefore: valid(0) } }],
    ['validBefore is over an hour away', { extra: { ...baseExtra, validBefore: valid(3601) } }],
    ['validBefore is not a number', { extra: { ...baseExtra, validBefore: 'soon' } }],
  ])('refuses when %s', (_name, overrides) => {
    expect(checkQuote(quote(overrides), fujiDeployment, nowSeconds).ok).toBe(false);
  });

  it('refuses another x402 version', () => {
    const q = { ...quote(), x402Version: 1 } as unknown as ReturnType<typeof quote>;
    expect(checkQuote(q, fujiDeployment, nowSeconds).ok).toBe(false);
  });

  it('refuses a quote with no payment option', () => {
    expect(checkQuote({ ...quote(), accepts: [] } as never, fujiDeployment, nowSeconds).ok).toBe(
      false,
    );
  });
});
