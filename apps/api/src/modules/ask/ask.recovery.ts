// Brings every question that still has money in escrow to an on-chain end, whatever happened to
// this process in the meantime (system-design §5.6 D and F, AP-05-AC08, AP-03-AC06).
//
// One routine does both jobs: it runs once at startup, BEFORE the server takes requests (so the
// nonce counter starts from a reconciled state), then again on a timer. The chain is the truth:
// a row is closed from a receipt's event, or from the chain's status; never from the DB alone.
import type { Hex } from 'viem';
import { RECEIPT_TIMEOUT_MS } from '../../shared/tx-queue.js';
import {
  readDepositedBetween,
  readLatestBlock,
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
  readCheckpoint,
  transitionStage,
  writeCheckpoint,
  type QuestionRow,
  type Stage,
} from './ask.repository.js';

export interface RecoveryDeps {
  ctx: AskContext;
  pipeline: Pipeline;
  // contracts/deployments/fuji.json: the scan for stray deposits starts here.
  deploymentBlock: bigint;
  scanChunk?: number;
  // How far back to scan when there is no checkpoint.
  lookbackBlocks?: number;
  // Pause between two log reads of one scan, so catching up never looks like an attack to the RPC.
  scanPauseMs?: number;
  intervalMs: number;
}

export interface Recovery {
  // Table D: reconcile every unresolved row with the chain. Await it before accepting requests, so
  // the nonce counter starts from a settled state. The scan for stray deposits is NOT awaited: it
  // runs in the background from start() on, because catching up can take minutes.
  startup(): Promise<void>;
  // One periodic pass; safe to call while requests run.
  sweep(): Promise<void>;
  // §5.6 F: the entry the indexer (A6) calls for every Deposited log it records.
  onDeposited(qid: Hex): Promise<boolean>;
  start(): void;
  stop(): void;
}

const UNRESOLVED: readonly Stage[] = ['DEPOSITING', 'ANSWERING', 'CHECKING', 'SETTLING'];
// The public Fuji RPC answers eth_getLogs for at most 100 blocks ("block range too large ... exceeds
// the maximum of 100 blocks", read from the live endpoint on 14/11/2026). A better RPC can raise it
// with LOG_RANGE_BLOCKS.
export const DEFAULT_SCAN_CHUNK = 100;
// With no checkpoint (a new or lost database) the scan looks back this far, not to the deployment
// block: 100 blocks per read, that would be ~430 reads for every day since deployment. Fuji makes
// about one block per 2 s. A deposit older than this is still safe: its payer can claimRefund after
// the deadline without the server (AP-06).
export const DEFAULT_LOOKBACK_BLOCKS = 43_200;
// Below this a range error is not about the range: stop instead of asking for ever smaller pieces.
const MIN_SCAN_CHUNK = 25;
// One pass reads at most this many ranges; the rest waits for the next sweep. A long catch-up is
// spread out instead of sent as one burst (a public RPC bans bursts: Cloudflare error 1015).
const MAX_SCAN_CALLS_PER_PASS = 40;
// Catching up is not latency-critical, and the public RPC has banned bursts: a full lookback of
// ~430 reads takes about 7 minutes at this pace.
const DEFAULT_SCAN_PAUSE_MS = 1_000;
const SCAN_BACKOFF_START_MS = 60_000;
const SCAN_BACKOFF_MAX_MS = 10 * 60_000;

// Only an error that says the RANGE is the problem may shrink it. A rate limit or a dead node is not
// fixed by asking for less, and retrying it at once is what gets an IP banned.
function isRangeError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as { details?: string }).details ?? ''}`
      : '';
  if (/429|rate.?limit|too many requests|timeout|fetch failed|ECONN/i.test(text)) return false;
  return /range|too (large|many|big)|exceed|more than|limit exceeded|response size/i.test(text);
}

export function createRecovery(deps: RecoveryDeps): Recovery {
  const { ctx, pipeline } = deps;
  const { store, chain, logger, now } = ctx;
  let chunk = deps.scanChunk ?? DEFAULT_SCAN_CHUNK;
  const pauseMs = deps.scanPauseMs ?? DEFAULT_SCAN_PAUSE_MS;
  let scanCursor: bigint | undefined = readCheckpoint(store); // last block fully handled
  let scanFailures = 0;
  let scanBlockedUntil = 0; // unix ms: after a failed read, do not try again before this
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

  // Deposited logs from the deployment block (or where the last scan stopped), in chunks that
  // shrink when the RPC says the range is too big. Never throws: a scan that fails is retried on a
  // later sweep, with a growing wait, and the server runs meanwhile. The indexer (A6) replaces this
  // with a stored checkpoint.
  async function scan(): Promise<void> {
    if (now() < scanBlockedUntil) return;
    let calls = 0;
    try {
      const latest = await readLatestBlock(chain);
      let from: bigint;
      if (scanCursor !== undefined) from = scanCursor + 1n;
      else {
        const lookback = latest - BigInt(deps.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS) + 1n;
        from = lookback > deps.deploymentBlock ? lookback : deps.deploymentBlock;
      }
      while (from <= latest && calls < MAX_SCAN_CALLS_PER_PASS) {
        const to = from + BigInt(chunk) - 1n > latest ? latest : from + BigInt(chunk) - 1n;
        let qids: Hex[];
        try {
          calls += 1;
          qids = await readDepositedBetween(chain, from, to);
        } catch (error) {
          if (isRangeError(error) && chunk > MIN_SCAN_CHUNK) {
            chunk = Math.max(MIN_SCAN_CHUNK, Math.floor(chunk / 2));
            logger.warn({ chunk }, 'log range refused; retrying with a smaller range');
            continue;
          }
          throw error;
        }
        for (const qid of qids) {
          // A deposit that could not be handled must not be skipped: stop, keep the cursor, retry.
          if (!(await onDeposited(qid))) throw new Error('could not handle a Deposited log');
        }
        scanCursor = to;
        writeCheckpoint(store, to);
        from = to + 1n;
        if (from <= latest && pauseMs > 0)
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
      scanFailures = 0;
      if (from > latest) logger.info({ block: Number(latest) }, 'deposit scan caught up');
    } catch (error) {
      scanFailures += 1;
      const wait = Math.min(SCAN_BACKOFF_MAX_MS, SCAN_BACKOFF_START_MS * 2 ** (scanFailures - 1));
      scanBlockedUntil = now() + wait;
      logger.warn(
        {
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
          retryInMs: wait,
        },
        'deposit scan failed; will retry later',
      );
    }
  }

  async function pass(): Promise<void> {
    await rows();
    await scan();
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
        await pass();
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
      void this.sweep(); // the first scan begins now, in the background
      timer = setInterval(() => void this.sweep(), deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
