import type { QuestionResult } from '@askpay/shared/api';
import type { RefundReasonCode } from '@askpay/shared/errors';
import type { Citation } from '@askpay/shared/api';
import type { Address, Hex } from 'viem';
import {
  badgeOf,
  badgeOfChain,
  isSettled,
  type Badge,
  type ChainStatus,
} from '@/components/question/status';
import { shortHash } from '@/lib/format';
import { askMessages } from './messages';
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

// What the page read from the escrow itself (W5 §2.2): `off` while the API is enough.
export type ChainRead =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  // `now` and `deadline` are unix seconds; `now` is the latest block's timestamp.
  | {
      kind: 'data';
      status: ChainStatus;
      payer: Address;
      amount: bigint;
      deadline: number;
      now: number;
    };

// The payer's refund proved by this page's own claim: the tx, who got the money, and whether the
// wallet that clicked is that same wallet (it need not be: anyone may claim for the payer).
export type ClaimedRefund = { hash: Hex; payer: Address; byPayer: boolean };

// What the claim panel needs: who gets the money and how much, from the API or from the chain.
export type ClaimView = { payer: Address | undefined; amount: bigint | undefined };

export type NoticeView =
  | { kind: 'noBasis'; warnsAnswer: boolean }
  | { kind: 'failedCheck'; reason: 'INVALID_CITATION' | 'CHECKER_REJECTED'; warnsAnswer: true }
  | { kind: 'answerFailed' }
  | { kind: 'timeout'; warnsAnswer: boolean }
  // A claim by a wallet that is not the asker: the money went to the asker, not to "you".
  | { kind: 'timeoutToPayer'; payer: Address }
  | { kind: 'generic' }
  | { kind: 'claimable'; claim: ClaimView }
  // The chain says Open and the deadline is still ahead (the server is silent; the payer can wait).
  | { kind: 'chainOpenNotYet'; deadline: number }
  | { kind: 'chainPaid' }
  | { kind: 'chainRefunded' };

export type CitationView = {
  citation: Citation;
  tone: 'paid' | 'refund';
  // The two-line mark: PAID + settled + verifiedOnChain, nothing else (AP-07-AC02).
  verified: boolean;
};

export type AnswerView =
  { skeleton: true } | { skeleton?: false; text: string; tone: 'normal' | 'muted' };

export type Refresh = 'live' | 'retrying' | 'lostConnection' | 'unsettled';

// The API could not answer and the chain is being read or could not be read (design W5 §2.2).
export type ChainHint = 'reading' | 'failed' | undefined;

export type ResultView =
  | { kind: 'loading' }
  | { kind: 'notFound'; chain?: ChainHint }
  | { kind: 'loadFailed'; chain?: ChainHint }
  | { kind: 'notHeld'; question: string }
  | {
      kind: 'question';
      question: string;
      // Set when the page is drawn from the chain alone, so it says where the numbers come from.
      source?: 'chain';
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
  qid: string;
  result: QuestionResult | undefined;
  notFound: boolean;
  loadFailed: boolean;
  // Is another read scheduled? (useQuestionProgress)
  polling: boolean;
  // Read from the escrow (W5). `off` when the API is enough.
  chain?: ChainRead;
  // This page's own claimRefund was mined and its receipt carried the escrow's Refunded log (U-21).
  claimed?: ClaimedRefund | undefined;
};

const chainHint = (chain: ChainRead): ChainHint =>
  chain.kind === 'loading' ? 'reading' : chain.kind === 'failed' ? 'failed' : undefined;

// A question the API cannot describe, drawn from the escrow alone (W5 §2.2).
function chainOnlyView(qid: string, chain: Extract<ChainRead, { kind: 'data' }>): ResultView {
  const badge = badgeOfChain(chain);
  if (badge === undefined) return { kind: 'notFound' };
  const base = {
    kind: 'question' as const,
    question: askMessages.questionById(shortHash(qid)),
    source: 'chain' as const,
    badge,
    meta: { amount: chain.amount, settleKind: 'paid' as const },
    timeline: undefined,
    settled: false,
    citations: [],
    verifying: false,
    refresh: 'live' as const,
    actions: [],
  };
  switch (chain.status) {
    case 'Open':
      return {
        ...base,
        notice:
          badge === 'expired'
            ? { kind: 'claimable', claim: { payer: chain.payer, amount: chain.amount } }
            : { kind: 'chainOpenNotYet', deadline: chain.deadline },
      };
    case 'Paid':
      // The chain knows it was paid, not what the answer was, and `verifiedOnChain` is the server's
      // to say: no card and no mark (AP-07-AC02).
      return { ...base, settled: true, notice: { kind: 'chainPaid' } };
    default:
      return {
        ...base,
        meta: { ...base.meta, settleKind: 'refund' as const },
        settled: true,
        notice: { kind: 'chainRefunded' },
      };
  }
}

// The API's answer, corrected by the chain where the chain knows better (P2: the chain wins).
// Only a question the API still shows as open is touched; a settled one is the API's to describe.
function withChain(result: QuestionResult, chain: ChainRead): QuestionResult {
  if (chain.kind !== 'data') return result;
  const open = result.status === undefined || result.status === 'PENDING';
  if (open && chain.status === 'Open' && chain.now > chain.deadline) {
    // Indexer lag or stop: the API has not seen the deadline pass, the block has (§2.1 #3).
    return {
      ...result,
      status: 'CLAIMABLE',
      payer: result.payer ?? chain.payer,
      amount: result.amount ?? chain.amount.toString(),
    };
  }
  if (result.status === 'CLAIMABLE') {
    return {
      ...result,
      payer: result.payer ?? chain.payer,
      amount: result.amount ?? chain.amount.toString(),
    };
  }
  return result;
}

// The page after this wallet's own claimRefund, from its receipt (design W5 §4, U-21).
function claimedView(
  qid: string,
  result: QuestionResult | undefined,
  { hash, payer, byPayer }: ClaimedRefund,
  chain: ChainRead,
): ResultView {
  const amount =
    result?.amount !== undefined
      ? BigInt(result.amount)
      : chain.kind === 'data'
        ? chain.amount
        : undefined;
  return {
    kind: 'question',
    question: result?.question ?? askMessages.questionById(shortHash(qid)),
    ...(result === undefined && { source: 'chain' as const }),
    badge: 'refunded',
    meta: {
      ...(amount !== undefined && { amount }),
      ...(result?.createdAt !== undefined && { createdAt: result.createdAt }),
      ...(result?.tx?.deposit !== undefined && { deposit: result.tx.deposit }),
      settle: hash,
      settleKind: 'refund',
    },
    timeline: { stage: 'REFUNDED', status: 'REFUNDED', reason: 'TIMEOUT', settleTx: hash },
    settled: true,
    notice: byPayer ? { kind: 'timeout', warnsAnswer: false } : { kind: 'timeoutToPayer', payer },
    citations: [],
    verifying: false,
    refresh: 'live',
    actions: ['askAnother'],
  };
}

export function toResultView({
  qid,
  result,
  notFound,
  loadFailed,
  polling,
  chain = { kind: 'off' },
  claimed,
}: ResultInput): ResultView {
  // The payer's own tx proved the refund; until the API says the same, the receipt is what is shown.
  if (claimed !== undefined && !(result?.status === 'REFUNDED' && isSettled(result))) {
    return claimedView(qid, result, claimed, chain);
  }
  if (!result) {
    if (notFound || loadFailed) {
      // The API cannot say. The chain can, when it was asked and answered (P5).
      if (chain.kind === 'data' && chain.status !== 'None') return chainOnlyView(qid, chain);
      return notFound
        ? { kind: 'notFound', ...(chainHint(chain) && { chain: chainHint(chain) }) }
        : { kind: 'loadFailed', ...(chainHint(chain) && { chain: chainHint(chain) }) };
    }
    return { kind: 'loading' };
  }
  if (notFound) return { kind: 'notFound' };
  // The chain says Refunded before the API does (a claim by another tab or wallet, indexer lag).
  if (
    chain.kind === 'data' &&
    chain.status === 'Refunded' &&
    !(result.status === 'REFUNDED' && isSettled(result))
  ) {
    const view = chainOnlyView(qid, chain);
    return view.kind === 'question' ? { ...view, question: result.question } : view;
  }
  result = withChain(result, chain);

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
      notice: {
        kind: 'claimable',
        claim: {
          payer: result.payer as Address | undefined,
          amount: result.amount === undefined ? undefined : BigInt(result.amount),
        },
      },
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
