import { describe, expect, it } from 'vitest';
import { badgeOf, isSettled } from '@/components/question/status';

const TX = `0x${'5e'.repeat(32)}`;

describe('badgeOf (design W4 §3, AP-07-AC03): one rule for the result page and the dashboard', () => {
  it.each([
    ['PAID with a settle tx', 'PAID', TX, 'paid'],
    ['REFUNDED with a settle tx', 'REFUNDED', TX, 'refunded'],
    ['PAID without a settle tx', 'PAID', undefined, 'pending'],
    ['REFUNDED without a settle tx', 'REFUNDED', undefined, 'pending'],
    ['PENDING', 'PENDING', undefined, 'pending'],
    ['CLAIMABLE', 'CLAIMABLE', undefined, 'expired'],
    ['no status yet', undefined, undefined, 'pending'],
  ] as const)('%s -> %s', (_name, status, settleTx, badge) => {
    expect(badgeOf({ status, settleTx })).toBe(badge);
  });

  it('agrees with isSettled: settled exactly when the badge is paid or refunded', () => {
    for (const status of ['PENDING', 'PAID', 'REFUNDED', 'CLAIMABLE'] as const) {
      for (const settle of [undefined, TX]) {
        const badge = badgeOf({ status, settleTx: settle });
        expect(isSettled({ status, tx: { settle } })).toBe(
          badge === 'paid' || badge === 'refunded',
        );
      }
    }
  });
});
