import type { QuestionResult } from '@askpay/shared/api';

type QuestionStatus = NonNullable<QuestionResult['status']>;

// The one place that decides what a question's money status is called on screen (P2, AP-07-AC03).
// Shared by the result page (W3) and the dashboard (W4), so both use the same rule.

// The part of a QuestionResult / QuestionListItem the rules need.
export type Settleable = {
  status?: QuestionStatus | undefined;
  tx?: { settle?: string | undefined } | undefined;
};

// "Settled" is defined once: a closed status AND the settlement tx. StatusBadge, the timeline's
// last step, the poll stop condition and the dashboard rows all call this.
export function isSettled(item: Settleable): boolean {
  return (item.status === 'PAID' || item.status === 'REFUNDED') && item.tx?.settle !== undefined;
}

export type Badge = 'pending' | 'paid' | 'refunded' | 'expired';

// PAID or REFUNDED without the settlement tx is still "pending": the chain has not said it yet.
export function badgeOf({
  status,
  settleTx,
}: {
  status: QuestionStatus | undefined;
  settleTx: string | undefined;
}): Badge {
  if (status === 'CLAIMABLE') return 'expired';
  if (settleTx === undefined) return 'pending';
  if (status === 'PAID') return 'paid';
  if (status === 'REFUNDED') return 'refunded';
  return 'pending';
}

// What `questions(qid).status` says on the escrow (enum order of AskPayEscrow.Status).
export type ChainStatus = 'None' | 'Open' | 'Paid' | 'Refunded';
export const CHAIN_STATUSES: readonly ChainStatus[] = ['None', 'Open', 'Paid', 'Refunded'];

// The badge for a question read straight from the escrow (W5 §2.2), through the same module as
// `badgeOf` so there is one rule. `deadline` and `now` are unix seconds; `now` is the latest BLOCK's
// timestamp, not the user's clock. The contract allows claimRefund when timestamp > deadline.
// `None` has no badge: nothing is held, so there is nothing to show.
export function badgeOfChain({
  status,
  deadline,
  now,
}: {
  status: ChainStatus;
  deadline: number;
  now: number;
}): Badge | undefined {
  switch (status) {
    case 'None':
      return undefined;
    case 'Open':
      return now > deadline ? 'expired' : 'pending';
    case 'Paid':
      return 'paid';
    case 'Refunded':
      return 'refunded';
  }
}

export const BADGE_LABELS: Record<Badge, string> = {
  pending: 'ĐANG XỬ LÝ',
  paid: 'ĐÃ THANH TOÁN',
  refunded: 'ĐÃ HOÀN TIỀN',
  expired: 'QUÁ HẠN',
};
