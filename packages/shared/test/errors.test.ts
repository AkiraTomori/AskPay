import { describe, expect, it } from 'vitest';
import { ERROR_CODES, REFUND_REASONS } from '../src/errors.js';

describe('errors', () => {
  it('gives every error code a Vietnamese message and a valid HTTP status', () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(entry.message.length, code).toBeGreaterThan(0);
      expect(entry.httpStatus, code).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus, code).toBeLessThan(600);
    }
  });

  it('covers every contract refund reason', () => {
    expect(Object.keys(REFUND_REASONS).sort()).toEqual([
      'ANSWER_FAILED',
      'CHECKER_REJECTED',
      'INVALID_CITATION',
      'NO_CITATION',
      'TIMEOUT',
    ]);
  });
});
