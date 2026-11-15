import type { QuestionResult } from '@askpay/shared/api';
import type { RefundReasonCode } from '@askpay/shared/errors';
import type { Citation } from '@askpay/shared/api';
import { badgeOf, isSettled, type Badge } from '@/components/question/status';
import type { StepsInput } from './steps';

// A pure description of the /questions/[qid] screen (design W3 §3, §4). Components only draw it.
// Every "paid / refunded / verified" word on the page is derived here from `status` + `tx.settle`
// (the chain's event), never from `stage` (P2, AP-07-AC03).

// A settled PAID question with a card the server could not match to the chain (api.md §3.2).
export function hasUnverifiedCitation(result: QuestionResult): boolean {
  return (
    result.status === 'PAID' &&
    isSettled(result) &&
    (result.citations ?? []).some((citation) => !citation.verifiedOnChain)
  );
}

export type NoticeView =
  | { kind: 'noBasis'; warnsAnswer: boolean }
  | { kind: 'failedCheck'; reason: 'INVALID_CITATION' | 'CHECKER_REJECTED'; warnsAnswer: true }
  | { kind: 'answerFailed' }
  | { kind: 'timeout'; warnsAnswer: boolean }
  | { kind: 'generic' }
  | { kind: 'claimable' };

export type CitationView = {
  citation: Citation;
  tone: 'paid' | 'refund';
  // The two-line mark: PAID + settled + verifiedOnChain, nothing else (AP-07-AC02).
  verified: boolean;
};

export type AnswerView =
  { skeleton: true } | { skeleton?: false; text: string; tone: 'normal' | 'muted' };

export type Refresh = 'live' | 'retrying' | 'lostConnection' | 'unsettled';

export type ResultView =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'loadFailed' }
  | { kind: 'notHeld'; question: string }
  | {
      kind: 'question';
      question: string;
      badge: Badge;
      meta: {
        amount?: bigint;
        createdAt?: number;
        deposit?: string;
        settle?: string;
        settleKind: 'paid' | 'refund';
      };
      timeline: StepsInput | undefined; // undefined at CLAIMABLE
      settled: boolean;
      notice?: NoticeView;
      answer?: AnswerView;
      citations: CitationView[];
      // PAID but some card could not be matched to the chain yet (design §5.3).
      verifying: boolean;
      // How fresh the screen is (design W3 §7): `live` shows nothing; the others add one small line.
      //   retrying       a refresh failed, another is scheduled
      //   lostConnection a refresh failed and none is scheduled (nothing is "retrying")
      //   unsettled      closed on the server but no settlement tx yet, and the page stopped asking
      refresh: Refresh;
      actions: ('askAnother' | 'askAgain')[];
    };

export type ResultInput = {
  result: QuestionResult | undefined;
  notFound: boolean;
  loadFailed: boolean;
  // Is another read scheduled? (useQuestionProgress)
  polling: boolean;
};

export function toResultView({ result, notFound, loadFailed, polling }: ResultInput): ResultView {
  if (notFound) return { kind: 'notFound' };
  if (!result) return loadFailed ? { kind: 'loadFailed' } : { kind: 'loading' };

  const { status, stage } = result;
  if (status === undefined && (stage === 'QUOTED' || stage === 'EXPIRED')) {
    return { kind: 'notHeld', question: result.question };
  }

  const settled = isSettled(result);
  // The same rule as the dashboard rows (W4 U-16): one place decides the badge.
  const badge = badgeOf({ status, settleTx: result.tx?.settle });
  const closed = status === 'PAID' || status === 'REFUNDED';
  const refresh: Refresh = loadFailed
    ? polling
      ? 'retrying'
      : 'lostConnection'
    : closed && !settled && !polling
      ? 'unsettled'
      : 'live';
  const answerText = result.answer ?? undefined;
  const base = {
    kind: 'question' as const,
    question: result.question,
    meta: {
      ...(result.amount !== undefined && { amount: BigInt(result.amount) }),
      ...(result.createdAt !== undefined && { createdAt: result.createdAt }),
      ...(result.tx?.deposit !== undefined && { deposit: result.tx.deposit }),
      ...(result.tx?.settle !== undefined && { settle: result.tx.settle }),
      settleKind: status === 'REFUNDED' ? ('refund' as const) : ('paid' as const),
    },
    refresh,
  };

  if (status === 'CLAIMABLE') {
    return {
      ...base,
      badge,
      timeline: undefined,
      settled: false,
      notice: { kind: 'claimable' },
      citations: [],
      verifying: false,
      actions: [],
    };
  }

  // Not settled: nothing from the answer is shown, even if the API already has it (U-12).
  if (!settled) {
    return {
      ...base,
      badge,
      timeline: { stage, ...(status && { status }), settleTx: result.tx?.settle },
      settled: false,
      answer: { skeleton: true },
      citations: [],
      verifying: false,
      actions: [],
    };
  }

  const timeline: StepsInput = {
    stage,
    ...(status && { status }),
    ...(result.reason !== undefined && { reason: result.reason }),
    settleTx: result.tx?.settle,
  };
  const cards = result.citations ?? [];
  const answer: AnswerView | undefined =
    answerText === undefined ? undefined : { text: answerText, tone: 'normal' };

  if (status === 'PAID') {
    return {
      ...base,
      badge,
      timeline,
      settled: true,
      ...(answer && { answer }),
      citations: cards.map((citation) => ({
        citation,
        tone: 'paid',
        verified: citation.verifiedOnChain,
      })),
      verifying: hasUnverifiedCitation(result),
      actions: ['askAnother'],
    };
  }

  // REFUNDED. The API does not say which card failed, so no card gets a tick or a verdict.
  const reason: RefundReasonCode | undefined = result.reason ?? undefined;
  const hasAnswer = answerText !== undefined;
  const refunded = {
    ...base,
    badge,
    timeline,
    settled: true,
    verifying: false,
  };
  const muted: AnswerView | undefined = hasAnswer ? { text: answerText, tone: 'muted' } : undefined;
  const refundCards = (): CitationView[] =>
    cards.map((citation) => ({ citation, tone: 'refund', verified: false }));

  switch (reason) {
    case 'NO_CITATION':
      return {
        ...refunded,
        notice: { kind: 'noBasis', warnsAnswer: hasAnswer && result.noBasis === false },
        ...(muted && { answer: muted }),
        citations: [],
        actions: ['askAnother'],
      };
    case 'INVALID_CITATION':
    case 'CHECKER_REJECTED':
      return {
        ...refunded,
        notice: { kind: 'failedCheck', reason, warnsAnswer: true },
        ...(muted && { answer: muted }),
        citations: refundCards(),
        actions: ['askAnother'],
      };
    case 'ANSWER_FAILED':
      return {
        ...refunded,
        notice: { kind: 'answerFailed' },
        citations: [],
        actions: ['askAgain'],
      };
    case 'TIMEOUT':
      return {
        ...refunded,
        notice: { kind: 'timeout', warnsAnswer: hasAnswer },
        ...(muted && { answer: muted }),
        citations: refundCards(),
        actions: ['askAnother'],
      };
    default:
      // No reason on the wire: say only that the money came back. Do not guess why.
      return {
        ...refunded,
        notice: { kind: 'generic' },
        ...(muted && { answer: muted }),
        citations: refundCards(),
        actions: ['askAnother'],
      };
  }
}
