// The read side of the API that is not one question: totals for the dashboard, the corpus check and
// the health report (api.md §6, §7, §8). Totals come from the chain's events, never from the
// questions table (P2, AP-08-AC02).
import { readFileSync } from 'node:fs';
import { formatEther, parseEther, type Hex } from 'viem';
import {
  evalSummarySchema,
  type CorpusInfo,
  type Health,
  type QuestionListItem,
  type Stats,
} from '@askpay/shared/api';
import { READ_CACHE_TTL_MS } from '../../shared/config.js';
import { AppError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { createTtlCache } from '../../shared/ttl-cache.js';
import type { AskService } from '../ask/ask.service.js';
import type { CorpusService } from '../corpus/corpus.service.js';
import type { Indexer } from '../indexer/indexer.service.js';
import {
  readLawRoot,
  readProviderBalance,
  txQueueHealthy,
  type PaymentChain,
} from '../payment/payment.service.js';

// Below this the provider could soon fail to settle (AP-03-AC07); /health warns but does not block.
const LOW_BALANCE_WEI = parseEther('0.2');

export const LAW_NAME = 'Bộ luật Lao động 2019 (45/2019/QH14)';
const EXPLORER = 'https://testnet.snowtrace.io/address';

// eval/results/latest.json, found from this file whether it runs from src or dist.
export const DEFAULT_EVAL_PATH = new URL('../../../../../eval/results/latest.json', import.meta.url)
  .pathname;

export interface HistoryDeps {
  chain: PaymentChain;
  corpus: CorpusService;
  indexer: Pick<Indexer, 'stats' | 'lagBlocks'>;
  ask: Pick<AskService, 'listQuestions'>;
  logger: Logger;
  now: () => number; // unix ms; the cache's clock, injectable so tests control it
  // The last LLM call's outcome. /health never calls the model: that would spend the daily quota on
  // whoever pings it.
  llmStatus: () => 'ok' | 'down';
  evalPath?: string;
}

export interface QuestionPage {
  items: QuestionListItem[];
  nextCursor?: string;
}

// stats, health and the first page of the list are kept for READ_CACHE_TTL_MS, and requests that
// arrive during a load share it: a dashboard left open on many screens must not turn into many RPC
// calls or many scans of chain_events (shared/ttl-cache.ts). Anything stale is at most that old.
export interface HistoryService {
  stats(): Promise<Stats>;
  corpusInfo(): Promise<CorpusInfo>;
  // `rpc: 'down'` makes the route answer 503; a stuck tx queue is `ok: false` with HTTP 200.
  health(): Promise<Health>;
  // Only the first page is cached: later pages are keyed by arbitrary cursors, so they are read
  // every time (and rate limited) rather than letting callers fill the cache.
  listQuestions(query: { limit: number; cursor?: string | undefined }): Promise<QuestionPage>;
}

// "1.42": two decimals of AVAX, cut not rounded, with no floating point.
function avaxText(wei: bigint): string {
  const [whole = '0', fraction = ''] = formatEther(wei).split('.');
  return `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`;
}

export function createHistoryService(deps: HistoryDeps): HistoryService {
  const { chain, corpus, indexer, logger } = deps;
  const evalPath = deps.evalPath ?? DEFAULT_EVAL_PATH;
  let registeredRoot: Hex | undefined;
  const statsCache = createTtlCache<Stats>(READ_CACHE_TTL_MS, deps.now);
  const healthCache = createTtlCache<Health>(READ_CACHE_TTL_MS, deps.now);
  const listCache = createTtlCache<QuestionPage>(READ_CACHE_TTL_MS, deps.now);

  // A missing or malformed file is "no eval yet", not an error on the dashboard (AP-09-AC03).
  function readEval(): Stats['eval'] {
    let text: string;
    try {
      text = readFileSync(evalPath, 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = evalSummarySchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // falls through
    }
    logger.warn('eval results file is not valid; reporting no eval');
    return null;
  }

  function computeStats(): Stats {
    const indexed = indexer.stats();
    const closed = indexed.paid + indexed.refunded;
    return {
      questions: indexed.questions,
      paid: indexed.paid,
      refunded: indexed.refunded,
      // Of the questions that ended, how many were refunded; one still open is neither.
      refundRate: closed === 0 ? 0 : indexed.refunded / closed,
      refundsByReason: indexed.refundsByReason,
      providerRevenue: indexed.providerRevenue.toString(),
      lastIndexedBlock: indexed.lastIndexedBlock,
      eval: readEval(),
    };
  }

  async function computeHealth(): Promise<Health> {
    const llm = deps.llmStatus();
    try {
      const [balance, lag] = await Promise.all([readProviderBalance(chain), indexer.lagBlocks()]);
      return {
        // A stuck tx queue cannot settle what it holds, so it makes the server not ok (§5.6 C).
        ok: txQueueHealthy(chain),
        rpc: 'ok',
        llm,
        providerBalanceAvax: avaxText(balance),
        lowBalance: balance < LOW_BALANCE_WEI,
        indexerLagBlocks: lag,
      };
    } catch {
      return {
        ok: false,
        rpc: 'down',
        llm,
        providerBalanceAvax: '0.00',
        lowBalance: false,
        indexerLagBlocks: 0,
      };
    }
  }

  return {
    stats: () => statsCache.get('stats', computeStats),

    // A "down" answer is not kept: when the RPC comes back, the next request must say so.
    health: () => healthCache.get('health', computeHealth, (health) => health.rpc === 'ok'),

    async listQuestions(query) {
      if (query.cursor !== undefined) return deps.ask.listQuestions(query);
      return listCache.get(`first:${query.limit}`, () => deps.ask.listQuestions(query));
    },

    async corpusInfo() {
      // A law's root is set once and never changes (LawRootAlreadySet), so one successful read is
      // kept: the dashboard must not cost an RPC call per view on a rate-limited public RPC.
      if (!registeredRoot) {
        try {
          registeredRoot = await readLawRoot(chain, corpus.lawId);
        } catch {
          throw new AppError('CHAIN_UNAVAILABLE');
        }
      }
      const onChainRoot = registeredRoot;
      const docs = corpus.docs();
      return {
        lawId: corpus.lawId,
        lawName: LAW_NAME,
        khoanCount: docs.length,
        dieuCount: new Set(docs.map((doc) => doc.dieu)).size,
        repoRoot: corpus.root,
        onChainRoot,
        rootMatches: onChainRoot.toLowerCase() === corpus.root.toLowerCase(),
        escrow: chain.escrow.toLowerCase() as Hex,
        explorer: `${EXPLORER}/${chain.escrow}`,
      };
    },
  };
}
