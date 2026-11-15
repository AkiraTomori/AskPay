import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@/lib/api';
import { classifySubmit } from '@/features/ask/submit-outcome';

type R = ApiResult<never>;
const error = (status: number, code: string, details?: unknown) =>
  ({ kind: 'error', status, code, message: '', details }) as unknown as R;

describe('classifySubmit: only an explicit rejection proves nothing was held (AP-03-AC06)', () => {
  it('treats 200, 202 and 409 already settled as held', () => {
    expect(
      classifySubmit({ kind: 'data', status: 200, data: {} as never, headers: new Headers() }),
    ).toEqual({ kind: 'held' });
    expect(
      classifySubmit({ kind: 'data', status: 202, data: {} as never, headers: new Headers() }),
    ).toEqual({ kind: 'held' });
    expect(classifySubmit(error(409, 'QUESTION_ALREADY_SETTLED'))).toEqual({ kind: 'held' });
    expect(classifySubmit(error(409, 'QUESTION_ALREADY_SETTLED', { qid: 'x' }))).toEqual({
      kind: 'held',
    });
  });
  it.each<[string, R]>([
    ['network', { kind: 'network', cause: new Error('x') }],
    ['malformed', { kind: 'malformed', status: 502 }],
    ['500', error(500, 'INTERNAL_ERROR')],
    ['LLM_UNAVAILABLE', error(502, 'LLM_UNAVAILABLE')],
  ])('%s is unsure', (_name, result) => {
    expect(classifySubmit(result)).toEqual({ kind: 'unsure' });
  });
  it('rejections before the deposit are certain', () => {
    expect(classifySubmit(error(404, 'QUESTION_NOT_FOUND'))).toEqual({ kind: 'quoteGone' });
    expect(classifySubmit(error(400, 'VALIDATION_FAILED'))).toMatchObject({ kind: 'failed' });
    expect(classifySubmit(error(409, 'QUESTION_MISMATCH'))).toMatchObject({ kind: 'failed' });
    expect(classifySubmit(error(402, 'PAYMENT_INVALID'))).toEqual({
      kind: 'failed',
      error: { kind: 'api', code: 'PAYMENT_INVALID' },
    });
    expect(classifySubmit(error(503, 'CHAIN_UNAVAILABLE'))).toEqual({
      kind: 'busy',
      reason: 'chainBusy',
    });
    expect(classifySubmit(error(429, 'RATE_LIMITED'))).toEqual({
      kind: 'busy',
      reason: 'rateLimited',
    });
  });
  it('AP-03-AC05: reads the balance and price from INSUFFICIENT_BALANCE details', () => {
    const details = {
      reason: 'INSUFFICIENT_BALANCE',
      balance: '10000',
      price: '50000',
      faucetUrl: 'https://faucet.circle.com',
    };
    expect(classifySubmit(error(402, 'PAYMENT_INVALID', details))).toEqual({
      kind: 'insufficient',
      balance: 10_000n,
      price: 50_000n,
    });
  });
});
