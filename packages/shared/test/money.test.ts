import { describe, expect, it } from 'vitest';
import { formatUsdc, parseUnits, unitsToString } from '../src/money.js';

describe('money', () => {
  it('formats USDC units without float math', () => {
    expect(formatUsdc(50_000n)).toBe('0.05');
    expect(formatUsdc(1_000_000n)).toBe('1');
    expect(formatUsdc(1_234_567n)).toBe('1.234567');
    expect(formatUsdc(0n)).toBe('0');
    expect(formatUsdc(2n ** 70n)).toBe('1180591620717411.303424');
  });

  it('round-trips integer strings through bigint', () => {
    expect(unitsToString(parseUnits('50000'))).toBe('50000');
  });

  it.each(['', '-1', '1.5', '01', '1e6', ' 5', '0x10'])('rejects %j as an amount', (value) => {
    expect(() => parseUnits(value)).toThrow(RangeError);
  });

  it('rejects negative bigint', () => {
    expect(() => unitsToString(-1n)).toThrow(RangeError);
    expect(() => formatUsdc(-1n)).toThrow(RangeError);
  });
});

describe('uint256 bound', () => {
  const max = (2n ** 256n - 1n).toString();

  it('accepts uint256 max and rejects one above it', () => {
    expect(parseUnits(max)).toBe(2n ** 256n - 1n);
    expect(() => parseUnits((2n ** 256n).toString())).toThrow(RangeError);
    expect(() => unitsToString(2n ** 256n)).toThrow(RangeError);
  });
});
