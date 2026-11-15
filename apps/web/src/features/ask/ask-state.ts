import type { ErrorCode } from '@askpay/shared/errors';
import type { Hex } from 'viem';
import type { Quote, SignedPayment } from './payment';
import type { Stage } from './steps';

// State machine of useAsk (design W2 §3). One tagged union; components only read it.
export type AskError =
  | { kind: 'api'; code: ErrorCode }
  | { kind: 'network' }
  | { kind: 'quoteMismatch' }
  | { kind: 'signatureExpired' };

// Why the form is back on the question with nothing held.
export type EditingNotice = 'quoteExpired' | 'expiredWhileSigning';

export type QuotedNotice =
  | { kind: 'signRejected' }
  | { kind: 'signFailed' }
  | { kind: 'walletPending' }
  | { kind: 'chainBusy' }
  | { kind: 'rateLimited' }
  // From the server's INSUFFICIENT_BALANCE details, for when the web could not read the balance.
  | { kind: 'insufficient'; balance: bigint; price: bigint };

export type AskState =
  | { kind: 'editing'; notice?: EditingNotice }
  | { kind: 'quoting'; question: string }
  // `payment` is set only after a rejected send that definitely held no money (503, 429): the
  // button then resends exactly that header.
  | {
      kind: 'quoted';
      question: string;
      quote: Quote;
      notice?: QuotedNotice;
      payment?: SignedPayment;
    }
  | { kind: 'signing'; question: string; quote: Quote }
  | { kind: 'submitting'; question: string; quote: Quote; payment: SignedPayment; stage?: Stage }
  | { kind: 'unsure'; question: string; quote: Quote; payment: SignedPayment; stage?: Stage }
  | { kind: 'failed'; question: string; error: AskError }
  | { kind: 'redirecting'; qid: Hex };

// Stages that prove the escrow holds the money, or that the server has taken over the work.
// DEPOSITING is not one of them: the server can still put the question back to QUOTED.
export const HELD_STAGES: ReadonlySet<Stage> = new Set([
  'ANSWERING',
  'CHECKING',
  'SETTLING',
  'PAID',
  'REFUNDED',
]);

export function errorNeedsNewQuote(error: AskError): boolean {
  return (
    error.kind === 'signatureExpired' || (error.kind === 'api' && error.code === 'PAYMENT_INVALID')
  );
}
