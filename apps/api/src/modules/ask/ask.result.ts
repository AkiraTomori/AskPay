// What an API caller may see of a question (api.md §3.2, §4). One mapping, used by POST /ask, by
// the 409 replay answer and by GET /questions/:qid, so they cannot disagree.
//
// P2: money and conclusion (status, reason, amount, tx, deadline) come from the chain's events when
// the indexer has them; the stage in the database only says "in progress" until then. Where the two
// disagree, the chain wins.
import type { QuestionListItem, QuestionResult } from '@askpay/shared/api';
import type { CorpusService } from '../corpus/corpus.service.js';
import type { ChainView } from '../indexer/indexer.service.js';
import type { QuestionRow } from './ask.repository.js';

export interface ResultContext {
  view?: ChainView | undefined;
  // Already decided by the verifier from the receipt; shown on every card of a PAID question.
  verified: boolean;
  nowMs: number;
}

type Status = NonNullable<QuestionResult['status']>;

interface Money {
  status: Status | undefined;
  stage: QuestionRow['stage'];
  reason: QuestionRow['reason'];
  settleTx: string | undefined;
}

function moneyOf(row: QuestionRow, view: ChainView | undefined, nowMs: number): Money {
  const settleTx = view?.closed?.txHash ?? row.settleTx ?? undefined;
  if (view?.closed) {
    const paid = view.closed.name === 'Paid';
    return {
      status: paid ? 'PAID' : 'REFUNDED',
      stage: paid ? 'PAID' : 'REFUNDED',
      reason: paid ? null : (view.closed.reason ?? row.reason),
      settleTx,
    };
  }
  if (row.stage === 'PAID') return { status: 'PAID', stage: row.stage, reason: null, settleTx };
  if (row.stage === 'REFUNDED') {
    return { status: 'REFUNDED', stage: row.stage, reason: row.reason, settleTx };
  }
  const started = row.stage !== 'QUOTED' && row.stage !== 'EXPIRED';
  // Still Open on-chain and past the deadline: the payer may claim the money back (P5, AP-06).
  const claimable = view?.deposit !== undefined && view.deposit.deadline * 1000 <= nowMs;
  return {
    status: started ? (claimable ? 'CLAIMABLE' : 'PENDING') : undefined,
    stage: row.stage,
    reason: null,
    settleTx,
  };
}

export function toQuestionResult(
  row: QuestionRow,
  corpus: CorpusService,
  context: ResultContext,
): QuestionResult {
  const { view } = context;
  const money = moneyOf(row, view, context.nowMs);
  const started = row.stage !== 'QUOTED' && row.stage !== 'EXPIRED';
  const verified = context.verified && money.status === 'PAID';
  const payer = row.payer ?? view?.deposit?.payer;
  const amount = view?.deposit?.amount ?? row.price;
  const deposit = row.depositTx ?? view?.deposit?.txHash;
  return {
    qid: row.qid,
    question: row.question,
    stage: money.stage,
    ...(money.status ? { status: money.status } : {}),
    ...(money.status === 'REFUNDED' ? { reason: money.reason } : {}),
    ...(started ? { amount: amount.toString() } : {}),
    ...(payer ? { payer } : {}),
    ...(row.answer !== null ? { answer: row.answer } : {}),
    ...(row.noBasis !== null ? { noBasis: row.noBasis } : {}),
    ...(row.citations
      ? {
          citations: row.citations.map((citation) => ({
            lawId: citation.lawId,
            dieu: citation.dieu,
            khoan: citation.khoan,
            dieuTitle: citation.dieuTitle,
            quote: citation.quote,
            text: corpus.find(citation.dieu, citation.khoan)?.text ?? '',
            textHash: citation.textHash,
            quoteHash: citation.quoteHash,
            // The mark of AP-07-AC02: true only for a PAID question whose content hashes to the
            // Paid log read from the receipt (ask.verify.ts). Never claimed before proof (AP-07-AC03).
            verifiedOnChain: verified,
          })),
        }
      : {}),
    answerHash: row.answerHash,
    citationsHash: row.citationsHash,
    ...(deposit || money.settleTx
      ? {
          tx: {
            ...(deposit ? { deposit } : {}),
            ...(money.settleTx ? { settle: money.settleTx } : {}),
          },
        }
      : {}),
    ...(view?.deposit ? { deadline: view.deposit.deadline } : {}),
    createdAt: row.createdAt,
  };
}

const LIST_QUESTION_LENGTH = 120;

// A row of the dashboard list (api.md §5). Only called for started questions, so `status` exists.
export function toListItem(
  row: QuestionRow,
  view: ChainView | undefined,
  nowMs: number,
): QuestionListItem {
  const money = moneyOf(row, view, nowMs);
  const characters = Array.from(row.question);
  return {
    qid: row.qid,
    question:
      characters.length > LIST_QUESTION_LENGTH
        ? `${characters.slice(0, LIST_QUESTION_LENGTH - 1).join('')}…`
        : row.question,
    status: money.status ?? 'PENDING',
    reason: money.status === 'REFUNDED' ? money.reason : null,
    amount: (view?.deposit?.amount ?? row.price).toString(),
    createdAt: row.createdAt,
    tx: money.settleTx ? { settle: money.settleTx as `0x${string}` } : {},
  };
}
