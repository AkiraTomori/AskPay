// Reads every escrow event into chain_events (T-09) and hands two kinds of them to the ask module:
// a Deposited nobody is looking after (§5.6 F) and a Paid or Refunded that closed a question.
//
// This is the scan that A5 kept in ask.recovery, with the same safeguards: the public RPC limits the
// block range and the call rate, so a read that fails is retried later with a growing wait and never
// stops the server. The checkpoint moves only after a range is stored AND handled.
import type { Hex } from 'viem';
import { refundReasonCodes, type RefundReasonCode } from '@askpay/shared/errors';
import type { Logger } from '../../shared/logger.js';
import type { Store } from '../../shared/store.js';
import {
  readEventsBetween,
  readLatestBlock,
  type ChainEvent,
  type PaymentChain,
  type SettleEvent,
} from '../payment/payment.service.js';
import {
  eventsNamed,
  eventsOfQids,
  insertEvents,
  readCheckpoint,
  writeCheckpoint,
  type StoredEvent,
} from './indexer.repository.js';

// The public Fuji RPC answers eth_getLogs for at most 100 blocks ("block range too large ... exceeds
// the maximum of 100 blocks", read from the live endpoint on 14/11/2026). A better RPC can raise it
// with LOG_RANGE_BLOCKS.
export const DEFAULT_SCAN_CHUNK = 100;
// With no checkpoint (a new or lost database) the scan looks back this far, not to the deployment
// block: 100 blocks per read, that would be ~430 reads for every day since deployment. Fuji makes
// about one block per 2 s. Owner decision 14/11/2026 (§5.6 F): the default stays 24 hours. Statistics
// then cover only what was read since. Owner decision 15/11/2026: the first run of the demo database
// sets SCAN_LOOKBACK_BLOCKS to reach the deployment block, so /stats covers the whole escrow.
export const DEFAULT_LOOKBACK_BLOCKS = 43_200;
// Below this a range error is not about the range: stop instead of asking for ever smaller pieces.
const MIN_SCAN_CHUNK = 25;
// One pass reads at most this many ranges; the rest waits for the next sweep. A long catch-up is
// spread out instead of sent as one burst (a public RPC bans bursts: Cloudflare error 1015).
const MAX_SCAN_CALLS_PER_PASS = 40;
const DEFAULT_SCAN_PAUSE_MS = 1_000;
const SCAN_BACKOFF_START_MS = 60_000;
const SCAN_BACKOFF_MAX_MS = 10 * 60_000;

// What the chain says about one question, as far as the indexer has read (P2).
export interface ChainView {
  deposit?: { payer: Hex; amount: bigint; deadline: number; txHash: Hex };
  closed?: {
    name: 'Paid' | 'Refunded';
    amount: bigint;
    txHash: Hex;
    reason?: RefundReasonCode;
  };
}

export interface IndexedStats {
  questions: number;
  paid: number;
  refunded: number;
  refundsByReason: Record<RefundReasonCode, number>;
  providerRevenue: bigint;
  lastIndexedBlock: number;
}

export interface IndexerDeps {
  store: Store;
  chain: PaymentChain;
  logger: Logger;
  now: () => number;
  // contracts/deployments/fuji.json: nothing before this block can hold an event of this escrow.
  deploymentBlock: bigint;
  // §5.6 F: a Deposited log. Resolves false when it could not be handled, so the scan stops there
  // and retries instead of skipping it.
  onDeposited: (qid: Hex) => Promise<boolean>;
  // A Paid or Refunded log: the question is closed by this tx.
  onClosed: (qid: Hex, event: SettleEvent, txHash: Hex) => void;
  scanChunk?: number;
  lookbackBlocks?: number;
  scanPauseMs?: number;
  intervalMs: number;
}

export interface Indexer {
  // One pass; safe to call while requests run. Never throws.
  sweep(): Promise<void>;
  start(): void;
  stop(): void;
  viewsOf(qids: readonly Hex[]): Map<Hex, ChainView>;
  stats(): IndexedStats;
  // How far the last indexed block trails the chain head.
  lagBlocks(): Promise<number>;
}

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

const isReason = (value: string | undefined): value is RefundReasonCode =>
  (refundReasonCodes as readonly string[]).includes(value ?? '');

function settleEventOf(event: ChainEvent): SettleEvent | undefined {
  if (event.name === 'Paid') {
    return {
      name: 'Paid',
      answerHash: event.args.answerHash as Hex,
      citationsHash: event.args.citationsHash as Hex,
    };
  }
  if (event.name === 'Refunded' && isReason(event.args.reason)) {
    return { name: 'Refunded', reason: event.args.reason };
  }
  return undefined;
}

export function createIndexer(deps: IndexerDeps): Indexer {
  const { store, chain, logger, now } = deps;
  let chunk = deps.scanChunk ?? DEFAULT_SCAN_CHUNK;
  const pauseMs = deps.scanPauseMs ?? DEFAULT_SCAN_PAUSE_MS;
  let cursor: bigint | undefined = readCheckpoint(store); // last block fully handled
  let failures = 0;
  let blockedUntil = 0; // unix ms: after a failed read, do not try again before this
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping = false;

  // Where a scan with no checkpoint begins: the lookback window, but never before the deployment.
  function firstBlock(latest: bigint): bigint {
    const lookback = latest - BigInt(deps.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS) + 1n;
    return lookback > deps.deploymentBlock ? lookback : deps.deploymentBlock;
  }

  // Closing logs first: a question closed in the same range needs no work for its Deposited log.
  async function handle(events: readonly ChainEvent[]): Promise<void> {
    for (const event of events) {
      const settle = settleEventOf(event);
      if (settle && event.qid) deps.onClosed(event.qid, settle, event.txHash);
    }
    for (const event of events) {
      if (event.name !== 'Deposited' || !event.qid) continue;
      // A deposit that could not be handled must not be skipped: stop, keep the cursor, retry.
      if (!(await deps.onDeposited(event.qid))) throw new Error('could not handle a Deposited log');
    }
  }

  async function scan(): Promise<void> {
    if (now() < blockedUntil) return;
    let calls = 0;
    try {
      const latest = await readLatestBlock(chain);
      let from = cursor === undefined ? firstBlock(latest) : cursor + 1n;
      while (from <= latest && calls < MAX_SCAN_CALLS_PER_PASS) {
        const to = from + BigInt(chunk) - 1n > latest ? latest : from + BigInt(chunk) - 1n;
        let events: ChainEvent[];
        try {
          calls += 1;
          events = await readEventsBetween(chain, from, to);
        } catch (error) {
          if (isRangeError(error) && chunk > MIN_SCAN_CHUNK) {
            chunk = Math.max(MIN_SCAN_CHUNK, Math.floor(chunk / 2));
            logger.warn({ chunk }, 'log range refused; retrying with a smaller range');
            continue;
          }
          throw error;
        }
        insertEvents(store, events);
        await handle(events);
        cursor = to;
        writeCheckpoint(store, to);
        from = to + 1n;
        if (from <= latest && pauseMs > 0)
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
      failures = 0;
      if (from > latest) logger.info({ block: Number(latest) }, 'event index caught up');
    } catch (error) {
      failures += 1;
      const wait = Math.min(SCAN_BACKOFF_MAX_MS, SCAN_BACKOFF_START_MS * 2 ** (failures - 1));
      blockedUntil = now() + wait;
      logger.warn(
        {
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
          retryInMs: wait,
        },
        'event index failed; will retry later',
      );
    }
  }

  function viewsOf(qids: readonly Hex[]): Map<Hex, ChainView> {
    const views = new Map<Hex, ChainView>();
    for (const event of eventsOfQids(store, qids)) {
      if (!event.qid) continue;
      const view = views.get(event.qid) ?? {};
      if (event.name === 'Deposited') {
        view.deposit = {
          payer: event.args.payer as Hex,
          amount: BigInt(event.args.amount ?? '0'),
          deadline: Number(event.args.deadline),
          txHash: event.txHash,
        };
      } else if (event.name === 'Paid' || event.name === 'Refunded') {
        view.closed = {
          name: event.name,
          amount: BigInt(event.args.amount ?? '0'),
          txHash: event.txHash,
          ...(isReason(event.args.reason) ? { reason: event.args.reason } : {}),
        };
      }
      views.set(event.qid, view);
    }
    return views;
  }

  function stats(): IndexedStats {
    const refundsByReason = Object.fromEntries(
      refundReasonCodes.map((code) => [code, 0]),
    ) as Record<RefundReasonCode, number>;
    const deposited = new Set<string>();
    const paid = new Set<string>();
    const refunded = new Set<string>();
    let providerRevenue = 0n;
    const named: StoredEvent[] = eventsNamed(store, ['Deposited', 'Paid', 'Refunded']);
    for (const event of named) {
      if (!event.qid) continue;
      if (event.name === 'Deposited') deposited.add(event.qid);
      else if (event.name === 'Paid' && !paid.has(event.qid)) {
        paid.add(event.qid);
        // BigInt in JS, never SQL SUM: SQLite would turn a large amount into a float.
        providerRevenue += BigInt(event.args.amount ?? '0');
      } else if (event.name === 'Refunded' && !refunded.has(event.qid)) {
        refunded.add(event.qid);
        if (isReason(event.args.reason)) refundsByReason[event.args.reason] += 1;
      }
    }
    return {
      questions: deposited.size,
      paid: paid.size,
      refunded: refunded.size,
      refundsByReason,
      providerRevenue,
      lastIndexedBlock: Number(readCheckpoint(store) ?? 0n),
    };
  }

  return {
    sweep: async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        await scan();
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
    viewsOf,
    stats,
    async lagBlocks() {
      const latest = await readLatestBlock(chain);
      // Before the first scan has stored anything, the whole window is still to read.
      const indexed = readCheckpoint(store) ?? firstBlock(latest) - 1n;
      return indexed >= latest ? 0 : Number(latest - indexed);
    },
  };
}
