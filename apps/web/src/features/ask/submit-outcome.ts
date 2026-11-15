import { insufficientBalanceDetailsSchema } from '@askpay/shared/api';
import type { AskAccepted, QuestionResult } from '@askpay/shared/api';
import type { ApiResult } from '@/lib/api';
import type { AskError } from './ask-state';

// How the second POST ended, in the groups of design W2 §6.1. The split exists to protect
// AP-03-AC06: only a group-A answer proves the chain holds no money, so only then may the UI
// offer a new quote. Everything we cannot read is `unsure`, never an invitation to pay twice.
export type SubmitOutcome =
  | { kind: 'held' } // 200, 202 or 409 already settled: the escrow has the money, or the server took over
  | { kind: 'unsure' } // network error, timeout, 5xx, unreadable answer
  | { kind: 'quoteGone' } // 404: the quote expired, nothing was held
  | { kind: 'failed'; error: AskError } // rejected before holding money
  | { kind: 'insufficient'; balance: bigint; price: bigint }
  | { kind: 'busy'; reason: 'chainBusy' | 'rateLimited' }; // 503 / 429: resend the same signature

export function classifySubmit(result: ApiResult<QuestionResult | AskAccepted>): SubmitOutcome {
  if (result.kind === 'data') return { kind: 'held' };
  if (result.kind !== 'error') return { kind: 'unsure' };
  switch (result.code) {
    case 'QUESTION_ALREADY_SETTLED':
      return { kind: 'held' };
    case 'QUESTION_NOT_FOUND':
      return { kind: 'quoteGone' };
    case 'VALIDATION_FAILED':
    case 'QUESTION_MISMATCH':
      return { kind: 'failed', error: { kind: 'api', code: result.code } };
    case 'PAYMENT_INVALID': {
      const details = insufficientBalanceDetailsSchema.safeParse(result.details);
      return details.success
        ? {
            kind: 'insufficient',
            balance: BigInt(details.data.balance),
            price: BigInt(details.data.price),
          }
        : { kind: 'failed', error: { kind: 'api', code: 'PAYMENT_INVALID' } };
    }
    case 'CHAIN_UNAVAILABLE':
      return { kind: 'busy', reason: 'chainBusy' };
    case 'RATE_LIMITED':
      return { kind: 'busy', reason: 'rateLimited' };
    default:
      return { kind: 'unsure' };
  }
}
