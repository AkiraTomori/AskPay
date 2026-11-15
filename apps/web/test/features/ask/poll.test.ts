import { questionResultSchema } from '@askpay/shared/api';
import { describe, expect, it } from 'vitest';
import { SETTLE_POLL_LIMIT, nextPollDelay, type PollContext } from '@/features/ask/hooks';
import { citation, paidBody, refundedBody, resultBody, SETTLE_TX } from '../../helpers/ask-api';

const ctx = (over: Partial<PollContext> = {}): PollContext => ({
  unverifiedReads: 0,
  unsettledReads: 0,
  hidden: false,
  ...over,
});
const data = (body: Record<string, unknown>) => questionResultSchema.parse(body);

describe('nextPollDelay (design W3 §7)', () => {
  it('leaves the W2 cadence to the caller while PENDING (undefined)', () => {
    expect(nextPollDelay(undefined, ctx())).toBeUndefined();
    expect(nextPollDelay(data(resultBody({ stage: 'ANSWERING', status: 'PENDING' })), ctx())).toBe(
      undefined,
    );
  });

  it('stops for EXPIRED and for a settled, verified question', () => {
    expect(nextPollDelay(data(resultBody({ stage: 'EXPIRED' })), ctx())).toBe(false);
    expect(nextPollDelay(data(paidBody()), ctx())).toBe(false);
    expect(nextPollDelay(data(refundedBody('TIMEOUT')), ctx())).toBe(false);
  });

  it('a closed status without the settlement tx is polled every second, not stopped', () => {
    expect(nextPollDelay(data(paidBody({ tx: {} })), ctx())).toBe(1000);
    expect(nextPollDelay(data(refundedBody('TIMEOUT', { tx: {} })), ctx())).toBe(1000);
    expect(nextPollDelay(data(paidBody({ tx: { deposit: SETTLE_TX } })), ctx())).toBe(1000);
  });

  it('a closed status without the settlement tx is read at most SETTLE_POLL_LIMIT times', () => {
    const closed = data(paidBody({ tx: {} }));
    expect(nextPollDelay(closed, ctx({ unsettledReads: 1 }))).toBe(1000);
    expect(nextPollDelay(closed, ctx({ unsettledReads: SETTLE_POLL_LIMIT }))).toBe(1000);
    expect(nextPollDelay(closed, ctx({ unsettledReads: SETTLE_POLL_LIMIT + 1 }))).toBe(false);
    const refunded = data(refundedBody('TIMEOUT', { tx: {} }));
    expect(nextPollDelay(refunded, ctx({ unsettledReads: SETTLE_POLL_LIMIT + 1 }))).toBe(false);
  });

  it('an unmatched card is retried after 3, 6, 12, 24 s and then left alone', () => {
    const unverified = data(paidBody({ citations: [citation({ verifiedOnChain: false })] }));
    expect(
      [1, 2, 3, 4, 5, 6].map((reads) => nextPollDelay(unverified, ctx({ unverifiedReads: reads }))),
    ).toEqual([3000, 6000, 12000, 24000, false, false]);
  });

  it('CLAIMABLE is read every 10 s, and not at all in a hidden tab', () => {
    const claimable = data(resultBody({ stage: 'SETTLING', status: 'CLAIMABLE' }));
    expect(nextPollDelay(claimable, ctx())).toBe(10_000);
    expect(nextPollDelay(claimable, ctx({ hidden: true }))).toBe(false);
  });
});
