// Builds the services and wires them together (backend.md §1). server.ts and the test harness both
// call this, so tests run the same wiring as production, with fakes only at the edges: the chain,
// the LLM and the clock.
import type { Hex } from 'viem';
import type { Config } from './shared/config.js';
import { SWEEP_INTERVAL_MS } from './shared/config.js';
import type { LlmClient } from './shared/llm.js';
import type { Logger } from './shared/logger.js';
import type { Store } from './shared/store.js';
import { createAnswerService } from './modules/answer/answer.service.js';
import { createAskService, type AskService } from './modules/ask/ask.service.js';
import { createInflight, type AskContext } from './modules/ask/ask.context.js';
import { createPipeline, type Pipeline } from './modules/ask/ask.pipeline.js';
import { createRecovery, type Recovery } from './modules/ask/ask.recovery.js';
import { createVerifier } from './modules/ask/ask.verify.js';
import { createCheckerService, type VerdictSigner } from './modules/checker/checker.service.js';
import type { CorpusService } from './modules/corpus/corpus.service.js';
import { createHistoryService, type HistoryService } from './modules/history/history.service.js';
import { createIndexer, type Indexer } from './modules/indexer/indexer.service.js';
import type { PaymentChain } from './modules/payment/payment.service.js';
import { createRetrieval } from './modules/retrieval/retrieval.service.js';

export interface ComposeDeps {
  config: Pick<Config, 'priceUnits' | 'quoteTtlSeconds' | 'demoFakeCitation' | 'demoStall'>;
  store: Store;
  chain: PaymentChain;
  logger: Logger;
  llm: LlmClient;
  // The checker's account: a different key from the provider's (T-04).
  checkerSigner: VerdictSigner;
  corpus: CorpusService;
  // Outcome of the last LLM call, for /health (it never calls the model itself).
  llmStatus?: () => 'ok' | 'down';
  evalPath?: string;
  // contracts/deployments/fuji.json
  deploymentBlock: bigint;
  now?: () => number;
  randomSalt?: () => Hex;
  requestWaitMs?: number;
  sweepIntervalMs?: number;
  scanChunk?: number;
  lookbackBlocks?: number;
  scanPauseMs?: number;
}

export interface Composed {
  askService: AskService;
  historyService: HistoryService;
  pipeline: Pipeline;
  recovery: Recovery;
  indexer: Indexer;
}

export function compose(deps: ComposeDeps): Composed {
  const { store, chain, logger, llm, corpus } = deps;
  const ctx: AskContext = {
    store,
    chain,
    logger,
    now: deps.now ?? (() => Date.now()),
    inflight: createInflight(),
  };

  const checker = createCheckerService({
    llm,
    logger,
    signer: deps.checkerSigner,
    escrow: chain.escrow,
    corpus: corpus.docs(),
  });
  const verifier = createVerifier({ chain, corpus, logger });
  const pipeline = createPipeline({
    ctx,
    answer: createAnswerService({ llm, logger }),
    checker,
    corpus,
    retrieve: createRetrieval(corpus.docs()),
    demoFakeCitation: deps.config.demoFakeCitation,
    demoStall: deps.config.demoStall,
    onPaid: verifier.remember,
  });
  const recovery = createRecovery({
    ctx,
    pipeline,
    intervalMs: deps.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
  });
  const indexer = createIndexer({
    store,
    chain,
    logger,
    now: ctx.now,
    deploymentBlock: deps.deploymentBlock,
    // §5.6 F and A6: the indexer finds the logs, the ask module decides what each one means.
    onDeposited: recovery.onDeposited,
    onClosed: pipeline.recordClosed,
    intervalMs: deps.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
    ...(deps.scanChunk ? { scanChunk: deps.scanChunk } : {}),
    ...(deps.lookbackBlocks ? { lookbackBlocks: deps.lookbackBlocks } : {}),
    ...(deps.scanPauseMs !== undefined ? { scanPauseMs: deps.scanPauseMs } : {}),
  });
  const askService = createAskService({
    ctx,
    pipeline,
    corpus,
    config: deps.config,
    verifier,
    chainViews: indexer.viewsOf,
    ...(deps.requestWaitMs !== undefined ? { requestWaitMs: deps.requestWaitMs } : {}),
    ...(deps.randomSalt ? { randomSalt: deps.randomSalt } : {}),
  });
  const historyService = createHistoryService({
    chain,
    corpus,
    indexer,
    ask: askService,
    logger,
    now: ctx.now,
    llmStatus: deps.llmStatus ?? (() => 'ok'),
    ...(deps.evalPath ? { evalPath: deps.evalPath } : {}),
  });
  return { askService, historyService, pipeline, recovery, indexer };
}
