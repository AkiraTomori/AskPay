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
import { createCheckerService, type VerdictSigner } from './modules/checker/checker.service.js';
import type { CorpusService } from './modules/corpus/corpus.service.js';
import type { PaymentChain } from './modules/payment/payment.service.js';
import { createRetrieval } from './modules/retrieval/retrieval.service.js';

export interface ComposeDeps {
  config: Pick<Config, 'priceUnits' | 'quoteTtlSeconds' | 'demoFakeCitation'>;
  store: Store;
  chain: PaymentChain;
  logger: Logger;
  llm: LlmClient;
  // The checker's account: a different key from the provider's (T-04).
  checkerSigner: VerdictSigner;
  corpus: CorpusService;
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
  pipeline: Pipeline;
  recovery: Recovery;
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
  const pipeline = createPipeline({
    ctx,
    answer: createAnswerService({ llm, logger }),
    checker,
    corpus,
    retrieve: createRetrieval(corpus.docs()),
    demoFakeCitation: deps.config.demoFakeCitation,
  });
  const recovery = createRecovery({
    ctx,
    pipeline,
    deploymentBlock: deps.deploymentBlock,
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
    ...(deps.requestWaitMs !== undefined ? { requestWaitMs: deps.requestWaitMs } : {}),
    ...(deps.randomSalt ? { randomSalt: deps.randomSalt } : {}),
  });
  return { askService, pipeline, recovery };
}
