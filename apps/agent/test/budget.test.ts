import { describe, expect, it } from 'vitest';
import { createBudget, parseBudget } from '../src/budget.js';

describe('parseBudget', () => {
  it.each([
    ['0.2', 200_000n],
    ['0.20', 200_000n],
    ['0.200000', 200_000n],
    ['5', 5_000_000n],
    ['0.000001', 1n],
    ['12.5', 12_500_000n],
  ])('accepts %s', (text, units) => {
    expect(parseBudget(text)).toBe(units);
  });

  it.each([
    ['a bare leading dot (".5": strict on purpose, write 0.5)', '.5'],
    ['an exponent', '1e-2'],
    ['a negative amount', '-1'],
    ['a plus sign', '+1'],
    ['more than 6 decimals', '0.0000001'],
    ['an empty value', ''],
    ['whitespace only', '  '],
    ['text', 'abc'],
    ['a thousands separator', '1,5'],
    ['zero', '0'],
    ['zero with decimals', '0.000000'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseBudget(text)).toThrow(RangeError);
  });

  it('rejects a missing value', () => {
    expect(() => parseBudget(undefined)).toThrow(RangeError);
  });

  it('keeps exact units for amounts a float would round', () => {
    expect(parseBudget('0.1') + parseBudget('0.2')).toBe(300_000n);
    expect(parseBudget('9007199254740993')).toBe(9007199254740993n * 1_000_000n);
  });
});

describe('createBudget', () => {
  it('reserves up to the cap exactly and refuses the next unit', () => {
    const budget = createBudget(100_000n);
    expect(budget.reserve(50_000n)).toBe(true);
    expect(budget.reserve(50_000n)).toBe(true);
    expect(budget.committed()).toBe(100_000n);
    expect(budget.remaining()).toBe(0n);
    expect(budget.reserve(1n)).toBe(false);
    expect(budget.committed()).toBe(100_000n);
  });

  it('refuses a price above the cap without changing anything', () => {
    const budget = createBudget(40_000n);
    expect(budget.reserve(50_000n)).toBe(false);
    expect(budget.committed()).toBe(0n);
  });

  it('gives a reservation back, never below zero', () => {
    const budget = createBudget(100_000n);
    budget.reserve(50_000n);
    budget.release(50_000n);
    expect(budget.committed()).toBe(0n);
    budget.release(50_000n);
    expect(budget.committed()).toBe(0n);
    expect(budget.reserve(100_000n)).toBe(true);
  });

  it('refuses a negative amount', () => {
    expect(createBudget(100n).reserve(-1n)).toBe(false);
  });
});
