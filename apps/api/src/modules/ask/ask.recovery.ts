// Brings every question that still has money in escrow to an on-chain end, whatever happened to
// this process in the meantime (system-design §5.6 D and F, AP-05-AC08, AP-03-AC06).
//
// It runs once at startup, BEFORE the server takes requests (so the nonce counter starts from a
// reconciled state), then again on a timer. The chain is the truth: a row is closed from a receipt's
// event, or from the chain's status; never from the DB alone. The scan for stray deposits is the
// indexer's job (A6); it calls onDeposited for every Deposited log it reads.
import type { Hex } from 'viem';
import { RECEIPT_TIMEOUT_MS } from '../../shared/tx-queue.js';
import {
  readNonceState,
  readPendingFees,
  readQuestion,
  readReceipt,
} from '../payment/payment.service.js';
import type { AskContext } from './ask.context.js';
import type { Pipeline } from './ask.pipeline.js';
import {
  findQuestion,
  listByStages,
  patchQuestion,
  transitionStage,
  type QuestionRow,
  type Stage,
} from './ask.repository.js';

export interface RecoveryDeps {
  ctx: AskContext;
  pipeline: Pipeline;
  intervalMs: number;
}

export interface Recovery {
  // Table D: reconcile every unresolved row with the chain. Await it before accepting requests, so
  // the nonce counter starts from a settled state.
  startup(): Promise<void>;
  // One periodic pass; safe to call while requests run.
  sweep(): Promise<void>;
  // §5.6 F: the entry the indexer calls for every Deposited log it records.
  onDeposited(qid: Hex): Promise<boolean>;
  start(): void;
  stop(): void;
}

const UNRESOLVED: readonly Stage[] = ['DEPOSITING', 'ANSWERING', 'CHECKING', 'SETTLING'];
export function createRecovery(deps: RecoveryDeps): Recovery {
  const { ctx, pipeline } = deps;
  const { store, chain, logger, now } = ctx;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping = false;
  // One replacement per question per process: a second one is the payer's claimRefund to settle.
  const replaced = new Set<Hex>();

  const cleared = { pendingTx: null, pendingNonce: null } as const;

  // Runs `work` with the question marked busy, so a concurrent sweep or request leaves it alone.
  // Resolves false only when the work failed, so a caller that must not skip anything (the scan) can
  // tell. Skipping because someone else holds the question is fine: they are handling it.
  async function exclusive(qid: Hex, work: () => Promise<void>): Promise<boolean> {
    if (ctx.inflight.has(qid)) return true;
    ctx.inflight.add(qid);
    try {
      await work();
      return true;
    } catch (error) {
      logger.error(
        { qid, error: error instanceof Error ? error.message : 'unknown' },
        'recovery step failed; will retry',
      );
      return false;
    } finally {
      ctx.inflight.delete(qid);
    }
  }

  // §5.6 D "Giải pending_tx theo nonce". Returns true when the question is now closed or waiting,
  // false when the pending tx is gone and the stage should be driven again.
  async function resolvePending(row: QuestionRow): Promise<boolean> {
    const { qid, pendingTx, pendingNonce } = row;
    if (pendingTx === null || pendingNonce === null) return false;

    const receipt = await readReceipt(chain, pendingTx, qid);
    if (receipt) {
      if (row.stage !== 'DEPOSITING' && receipt.success && receipt.event) {
        pipeline.finalize(qid, receipt.event, pendingTx);
        return true;
      }
      patchQuestion(store, qid, UNRESOLVED, now(), cleared);
      return false;
    }

    const { latest, pending } = await readNonceState(chain);
    if (latest > pendingNonce) {
      // The nonce is spent, by this tx or by its replacement: the chain says which way it went.
      patchQuestion(store, qid, UNRESOLVED, now(), cleared);
      return false;
    }
    if (pending > pendingNonce) {
      // Still in the mempool. A deposit cannot be replaced (its signature is not stored), so it
      // waits; the authorisation expires on its own. Settle and refund get ONE replacement.
      const waited = now() - row.updatedAt;
      if (row.stage === 'DEPOSITING' || waited < RECEIPT_TIMEOUT_MS || replaced.has(qid))
        return true;
      if ((await readQuestion(chain, qid)).status !== 'Open') {
        patchQuestion(store, qid, UNRESOLVED, now(), cleared);
        return false;
      }
      replaced.add(qid);
      const fees = (await readPendingFees(chain, pendingTx)) ?? {};
      await pipeline.resend(qid, { replace: { nonce: pendingNonce, fees } });
      return true;
    }
    // Neither: the tx never reached the network, or was dropped. Its nonce will be reused.
    patchQuestion(store, qid, UNRESOLVED, now(), cleared);
    return false;
  }

  // Drives a question whose pending tx is resolved (or never existed) to its next step.
  async function redrive(row: QuestionRow): Promise<void> {
    const { qid } = row;
    const question = await readQuestion(chain, qid);

    if (question.status === 'Paid' || question.status === 'Refunded') {
      await pipeline.syncFromChain(qid);
      return;
    }
    if (row.stage === 'DEPOSITING') {
      if (question.status === 'Open') {
        // The deposit landed after the request stopped waiting (§5.6 A).
        await pipeline.startLate(qid);
      } else {
        // Nothing is held: back to a fresh quote if it is still valid, expired otherwise.
        const stillValid = now() < row.quoteExpiresAt;
        transitionStage(
          store,
          qid,
          'DEPOSITING',
          stillValid ? 'QUOTED' : 'EXPIRED',
          now(),
          cleared,
        );
      }
      return;
    }
    // ANSWERING, CHECKING, SETTLING with no live code behind them. Resend the stored settle
    // exactly; with too little stored, refund. Never rerun the LLM (§5.6 D).
    if (question.status === 'Open') await pipeline.resend(qid);
  }

  async function reconcile(row: QuestionRow): Promise<void> {
    await exclusive(row.qid, async () => {
      const fresh = findQuestion(store, row.qid);
      if (!fresh || !UNRESOLVED.includes(fresh.stage)) return;
      if (await resolvePending(fresh)) return;
      const again = findQuestion(store, row.qid);
      if (again && UNRESOLVED.includes(again.stage)) await redrive(again);
    });
  }

  // §5.6 F and the lost-database row of D: a Deposited log nobody is responsible for.
  async function onDeposited(qid: Hex): Promise<boolean> {
    return exclusive(qid, async () => {
      const row = findQuestion(store, qid);
      if (row && !['DEPOSITING', 'QUOTED', 'EXPIRED'].includes(row.stage)) return; // known to a pipeline

      const question = await readQuestion(chain, qid);
      if (question.status !== 'Open') {
        if (row) await pipeline.syncFromChain(qid);
        return;
      }
      if (row?.stage === 'DEPOSITING') {
        await pipeline.startLate(qid);
        return;
      }
      // No row, or the payer was told "not paid" / "expired": nobody will answer this one, so the
      // provider refunds it now instead of leaving it for the payer to claim after 10 minutes.
      await pipeline.refund(qid, 'ORPHAN_DEPOSIT');
    });
  }

  async function rows(): Promise<void> {
    for (const row of listByStages(store, UNRESOLVED)) await reconcile(row);
  }

  return {
    async startup() {
      await rows();
    },
    onDeposited,
    async sweep() {
      if (sweeping) return;
      sweeping = true;
      try {
        await rows();
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : 'unknown' },
          'recovery sweep failed; will retry',
        );
      } finally {
        sweeping = false;
      }
    },
    start() {
      timer = setInterval(() => void this.sweep(), deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
