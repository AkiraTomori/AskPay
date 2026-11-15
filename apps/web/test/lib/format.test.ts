import { describe, expect, it } from 'vitest';
import { formatUsdcVi, formatVndEstimate, shortAddress, snowtraceAddressUrl } from '@/lib/format';

describe('formatUsdcVi', () => {
  it.each([
    [12_500_000n, '12,5'],
    [50_000n, '0,05'],
    [1_000_000n, '1'],
    [0n, '0'],
    [1n, '0,000001'],
  ])('formats %s base units as %s without rounding', (units, text) => {
    expect(formatUsdcVi(units)).toBe(text);
  });
});

describe('shortAddress', () => {
  it('keeps the head and the tail', () => {
    expect(shortAddress('0x869e95576f6dd6f06118cf733b4f307ae37ddce0')).toBe('0x869e…dce0');
  });
  it('leaves a value that is already short', () => {
    expect(shortAddress('0xabcd')).toBe('0xabcd');
  });
});

describe('snowtraceAddressUrl', () => {
  it('points at the Fuji testnet explorer', () => {
    expect(snowtraceAddressUrl('0xabc')).toBe('https://testnet.snowtrace.io/address/0xabc');
  });
});

describe('formatVndEstimate (design W2 §7)', () => {
  it('AP-02-AC03: 0.05 USDC is about 1.300đ', () => {
    expect(formatVndEstimate(50_000n)).toBe('1.300');
  });
  it('rounds to the nearest 100đ and groups thousands with dots', () => {
    expect(formatVndEstimate(1_000_000n)).toBe('26.000');
    expect(formatVndEstimate(10_000n)).toBe('300'); // 260đ → 300đ
    expect(formatVndEstimate(0n)).toBe('0');
  });
});
