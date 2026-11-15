import { describe, expect, it } from 'vitest';
import { stepStates } from '@/features/ask/steps';

describe('stepStates (AP-07-AC03)', () => {
  it('has the first step running while the signature is just sent', () => {
    expect(stepStates({ stage: undefined })).toEqual(['running', 'pending', 'pending', 'pending']);
    expect(stepStates({ stage: 'DEPOSITING' })).toEqual([
      'running',
      'pending',
      'pending',
      'pending',
    ]);
  });
  it('moves one step at a time', () => {
    expect(stepStates({ stage: 'ANSWERING' })).toEqual(['done', 'running', 'pending', 'pending']);
    expect(stepStates({ stage: 'CHECKING' })).toEqual(['done', 'done', 'running', 'pending']);
    expect(stepStates({ stage: 'SETTLING' })).toEqual(['done', 'done', 'done', 'running']);
  });
  it('W2-E15: the last step is done only with a status and a settle tx', () => {
    expect(stepStates({ stage: 'PAID' })[3]).toBe('running');
    expect(stepStates({ stage: 'PAID', status: 'PAID' })[3]).toBe('running');
    expect(stepStates({ stage: 'PAID', status: 'PAID', settleTx: '0xabc' })).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });
  it('shows skipped, never a tick, for steps a refund jumped over', () => {
    const refunded = { stage: 'REFUNDED', status: 'REFUNDED', settleTx: '0xabc' } as const;
    expect(stepStates({ ...refunded, reason: 'ANSWER_FAILED' })).toEqual([
      'done',
      'skipped',
      'skipped',
      'done',
    ]);
    expect(stepStates({ ...refunded, reason: 'NO_CITATION' })).toEqual([
      'done',
      'done',
      'skipped',
      'done',
    ]);
    expect(stepStates({ ...refunded, reason: 'CHECKER_REJECTED' })).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });
  it('shows nothing started when the stage went back to QUOTED', () => {
    expect(stepStates({ stage: 'QUOTED' })).toEqual(['pending', 'pending', 'pending', 'pending']);
  });
});
