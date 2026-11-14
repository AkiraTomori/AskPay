// The life of a question after its money is in escrow: answer (A2), check (A3), then ONE
// transaction that ends it: settle, or refundByProvider (system-design §5.6 A, B, C).
//
// Every path out of here ends in an on-chain event or in a question that recovery will pick up
// (ask.recovery.ts). Nothing here ever shows PAID or REFUNDED without a Paid or Refunded log (P2).
import { toBytes, keccak256, type Hex } from 'viem';
import { hashText, type Citation } from '@askpay/shared/leaf';
import type { AnswerService } from '../answer/answer.service.js';
import type { CheckerService } from '../checker/checker.service.js';
import type { CorpusService } from '../corpus/corpus.service.js';
import type { Candidate } from '../retrieval/retrieval.service.js';
import {
  readQuestionStatus,
  secondsLeft,
  sendRefund,
  sendSettle,
  type SendHooks,
  type SettleEvent,
  type SettleRequest,
  type SettleResult,
} from '../payment/payment.service.js';
import { PIPELINE_BUDGET_SECONDS, SETTLE_CUTOFF_SECONDS } from '../../shared/config.js';
import type { AskContext } from './ask.context.js';
import {
  findQuestion,
  patchQuestion,
  transitionStage,
  type QuestionRow,
  type Stage,
  type StoredCitation,
} from './ask.repository.js';

// Log codes that tell the server-refund cases apart (§5.6 B). All of them end in ANSWER_FAILED.
export type RefundCause =
  'LLM_FAILED' | 'CHECKER_FAILED' | 'SETTLE_BUG' | 'CUTOFF' | 'ORPHAN_DEPOSIT' | 'RESTART';

// system-design §5.5: the demo's worst case, honoured only with the env flag AND this prefix.
export const DEMO_FAKE_PREFIX = '#demo-fake';

export interface PipelineDeps {
  ctx: AskContext;
  answer: AnswerService;
  checker: CheckerService;
  corpus: CorpusService;
  retrieve: (question: string) => Candidate[];
  demoFakeCitation: boolean;
}

export interface Pipeline {
  // Answer, check and settle a deposited question. Resolves when it is final or this process has
  // done all it can; it never rejects, so a detached call cannot crash the server.
  run(qid: Hex): Promise<void>;
  // A deposit that landed after the request gave up (§5.6 A "Deposited tới sau", F).
  startLate(qid: Hex): Promise<void>;
  // Recovery's levers.
  refund(qid: Hex, cause: RefundCause, hooks?: Partial<SendHooks>): Promise<void>;
  resend(qid: Hex, hooks?: Partial<SendHooks>): Promise<void>;
  syncFromChain(qid: Hex): Promise<void>;
  finalize(qid: Hex, event: SettleEvent, settleTx: Hex): void;
}

const ACTIVE: readonly Stage[] = ['ANSWERING', 'CHECKING', 'SETTLING'];
const NOT_FINAL: readonly Stage[] = ['DEPOSITING', 'QUOTED', 'EXPIRED', ...ACTIVE];

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { ctx, answer, checker, corpus, retrieve } = deps;
  const { store, chain, logger, now } = ctx;

  // ---- persistence -----------------------------------------------------------------------

  // §5.6 C: the hash and nonce are written BEFORE the tx is sent, together with the stage change.
  // From any stage that is not final: a refund of a late or stray deposit starts from DEPOSITING,
  // QUOTED or EXPIRED.
  function hooksFor(qid: Hex, extra: Partial<SendHooks> = {}): SendHooks {
    return {
      onSigned: (tx) => {
        transitionStage(store, qid, NOT_FINAL, 'SETTLING', now(), {
          pendingTx: tx.hash,
          pendingNonce: tx.nonce,
        });
      },
      // Rule 1: only replace while the question is still open on-chain.
      shouldReplace: async () => (await readQuestionStatus(chain, qid)) === 'Open',
      ...extra,
    };
  }
  const clearPending = (qid: Hex) =>
    patchQuestion(store, qid, NOT_FINAL, now(), { pendingTx: null, pendingNonce: null });

  // ---- finishing -------------------------------------------------------------------------

  // The only place a question becomes PAID or REFUNDED from a transaction: from the event in its
  // receipt (P2), for this escrow and this qid (decoded in payment.chain).
  function finalize(qid: Hex, event: SettleEvent, settleTx: Hex): void {
    const base = { settleTx, pendingTx: null, pendingNonce: null } as const;
    if (event.name === 'Paid') {
      const row = findQuestion(store, qid);
      if (row?.answerHash && row.answerHash.toLowerCase() !== event.answerHash.toLowerCase()) {
        logger.error(
          { qid },
          'CITATIONS_MISMATCH: Paid event answerHash differs from the stored one',
        );
      }
      transitionStage(store, qid, NOT_FINAL, 'PAID', now(), { ...base, verdictPass: true });
    } else {
      transitionStage(store, qid, NOT_FINAL, 'REFUNDED', now(), { ...base, reason: event.reason });
    }
    logger.info({ qid, event: event.name, tx: settleTx }, 'question closed on-chain');
  }

  // The chain already closed it (our tx mined earlier, or the payer claimed after the deadline):
  // follow the chain's STATUS. The reason and tx hash come later from the indexer (A6) because no
  // receipt of ours says which transaction did it.
  async function syncFromChain(qid: Hex): Promise<void> {
    let status;
    try {
      status = await readQuestionStatus(chain, qid);
    } catch {
      logger.warn({ qid }, 'chain status unreadable; will retry');
      return;
    }
    const cleared = { pendingTx: null, pendingNonce: null } as const;
    if (status === 'Paid') transitionStage(store, qid, NOT_FINAL, 'PAID', now(), cleared);
    else if (status === 'Refunded') {
      transitionStage(store, qid, NOT_FINAL, 'REFUNDED', now(), cleared);
    }
  }

  // §5.6 B: what a finished send means for the question.
  async function handle(qid: Hex, result: SettleResult, wasSettle: boolean): Promise<void> {
    if (result.kind === 'mined') {
      if (result.success && result.event) return finalize(qid, result.event, result.hash);
      // Reverted, or no Paid/Refunded log: ask the chain rather than guess.
      clearPending(qid);
      return syncFromChain(qid);
    }
    if (result.kind === 'unknown') {
      // Nothing is lost: pending_tx is stored and recovery resolves it by nonce.
      logger.warn(
        { qid, stuck: result.stuck === true },
        'settle outcome unknown; recovery will resolve it',
      );
      return;
    }
    // not-sent: the simulation refused it, or the node did. The reason decides.
    clearPending(qid);
    switch (result.errorName) {
      case 'QuestionNotOpen':
        return syncFromChain(qid);
      case 'InvalidCheckerSignature':
      case 'BadCitations':
        // Deterministic (a key mismatch or an encoding drift): resending cannot help, so refund.
        logger.error({ qid, reason: result.errorName }, 'SETTLE_BUG');
        if (wasSettle) return refund(qid, 'SETTLE_BUG');
        return;
      case 'NotProvider':
        // Neither settle nor refund can be sent with this key. The payer's claimRefund is the way out.
        logger.error({ qid }, 'NOT_PROVIDER: the server key is not the escrow provider');
        return;
      default:
        logger.warn({ qid, reason: result.reason }, 'settle not sent; recovery will retry');
    }
  }

  // ---- sending ---------------------------------------------------------------------------

  async function refund(
    qid: Hex,
    cause: RefundCause,
    extra: Partial<SendHooks> = {},
  ): Promise<void> {
    logger.warn({ qid, cause }, 'refunding by provider (ANSWER_FAILED)');
    const result = await sendRefund(chain, qid, hooksFor(qid, extra));
    await handle(qid, result, false);
  }

  // The settle that the stored verdict describes. An empty list is the NO_CITATION path: the
  // chain refunds without needing a signature.
  function requestFrom(row: QuestionRow): SettleRequest | undefined {
    if (row.answerHash === null || row.citations === null) return undefined;
    if (row.citations.length > 0 && row.checkerSig === null) return undefined;
    const citations: Citation[] = row.citations.map((c) => ({
      lawId: c.lawId,
      dieu: c.dieu,
      khoan: c.khoan,
      textHash: c.textHash,
      quoteHash: c.quoteHash,
    }));
    return {
      qid: row.qid,
      answerHash: row.answerHash,
      citations,
      proofs: row.citations.map((c) => c.proof),
      pass: row.verdictPass ?? false,
      checkerSig: row.checkerSig ?? '0x',
    };
  }

  // Resends EXACTLY what was stored (same signature, same citations), or refunds when there is not
  // enough stored to do that (§5.6 D).
  async function resend(qid: Hex, extra: Partial<SendHooks> = {}): Promise<void> {
    const row = findQuestion(store, qid);
    if (!row) return;
    const request = requestFrom(row);
    if (!request) return refund(qid, 'RESTART', extra);
    const result = await sendSettle(chain, request, hooksFor(qid, extra));
    await handle(qid, result, true);
  }

  // ---- the pipeline ----------------------------------------------------------------------

  const demoQuestion = (question: string) =>
    deps.demoFakeCitation && question.startsWith(DEMO_FAKE_PREFIX);

  async function steps(qid: Hex): Promise<void> {
    const row = findQuestion(store, qid);
    if (row?.stage !== 'ANSWERING') return;

    const demo = demoQuestion(row.question);
    const question = demo ? row.question.slice(DEMO_FAKE_PREFIX.length).trim() : row.question;

    const outcome = await answer.answer(question, retrieve(question));
    if (outcome.kind === 'failed') return refund(qid, 'LLM_FAILED');

    const answerHash = hashText(outcome.answer);
    // C1 before the checker: no citation (or no basis) needs no verdict. The chain refunds
    // NO_CITATION from an empty list, so this goes through settle, not refundByProvider.
    if (outcome.noBasis || outcome.citations.length === 0) {
      transitionStage(store, qid, 'ANSWERING', 'CHECKING', now(), {
        answer: outcome.answer,
        noBasis: outcome.noBasis,
        answerHash,
        citations: [],
      });
      return resend(qid);
    }

    transitionStage(store, qid, 'ANSWERING', 'CHECKING', now(), {
      answer: outcome.answer,
      noBasis: false,
    });

    const items = outcome.citations.flatMap((citation) => {
      const found = corpus.find(citation.dieu, citation.khoan);
      return found ? [{ citation, found }] : [];
    });
    if (items.length !== outcome.citations.length) {
      // Cannot happen: citations are limited to retrieved Khoản, which come from this corpus.
      logger.error({ qid }, 'a cited Khoản is missing from the corpus');
      return refund(qid, 'CHECKER_FAILED');
    }

    // The demo swaps the first textHash BEFORE the checker, which does not check it (§5.5). The
    // Merkle proof stays that of the real leaf, so the chain sees the mismatch.
    const checkCitations = items.map(({ citation, found }, position) => ({
      lawId: corpus.lawId,
      dieu: citation.dieu,
      khoan: citation.khoan,
      textHash:
        demo && position === 0 ? keccak256(toBytes(`demo-fake-citation:${qid}`)) : found.textHash,
      quote: citation.quote,
    }));

    const verdict = await checker.check({
      qid,
      question,
      answer: outcome.answer,
      citations: checkCitations,
    });
    if (verdict.kind === 'failed') return refund(qid, 'CHECKER_FAILED');
    if (verdict.kind === 'no-citation') return refund(qid, 'CHECKER_FAILED'); // unreachable: C1 ran above

    const stored: StoredCitation[] = checkCitations.map((c, position) => ({
      lawId: c.lawId,
      dieu: c.dieu,
      khoan: c.khoan,
      dieuTitle: items[position]?.citation.dieuTitle ?? '',
      quote: c.quote,
      textHash: c.textHash,
      quoteHash: verdict.quoteHashes[position] as Hex,
      proof: corpus.proofOf(c.dieu, c.khoan),
    }));
    // Everything settle needs is stored BEFORE the tx is signed, so a restart resends it as is.
    patchQuestion(store, qid, ['CHECKING'], now(), {
      citations: stored,
      answerHash: verdict.answerHash,
      citationsHash: verdict.citationsHash,
      checkerSig: verdict.signature,
      verdictPass: verdict.pass,
    });
    return resend(qid);
  }

  async function run(qid: Hex): Promise<void> {
    ctx.inflight.add(qid);
    try {
      await steps(qid);
    } catch (error) {
      // Never let one question's failure reach the process (an unhandled rejection is fatal). The
      // row keeps whatever it stored, and recovery reconciles it.
      logger.error({ qid, error: errorText(error) }, 'pipeline crashed; recovery will take over');
    } finally {
      ctx.inflight.delete(qid);
    }
  }

  async function startLate(qid: Hex): Promise<void> {
    ctx.inflight.add(qid);
    try {
      const left = await secondsLeft(chain, qid);
      // Not enough time for an answer AND a settle before the cutoff: refund now (§5.6 A).
      if (left <= SETTLE_CUTOFF_SECONDS + PIPELINE_BUDGET_SECONDS) {
        await refund(qid, 'CUTOFF');
        return;
      }
      if (!transitionStage(store, qid, ['DEPOSITING', 'QUOTED', 'EXPIRED'], 'ANSWERING', now())) {
        return;
      }
      await steps(qid);
    } catch (error) {
      logger.error(
        { qid, error: errorText(error) },
        'late pipeline crashed; recovery will take over',
      );
    } finally {
      ctx.inflight.delete(qid);
    }
  }

  return { run, startLate, refund, resend, syncFromChain, finalize };
}
