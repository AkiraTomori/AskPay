// Runs the eval questions through the real answer and checker services (E1 design §2, §5).
//
// The steps mirror ask.pipeline.ts `steps()` (retrieve → answer → C1 → corpus.find → checker). That
// is a copy, so it can drift: if the pipeline's order of steps changes, change this too. It touches
// no payment, chain or store, and the checker signs with the key it is handed (a throwaway).
import type { Hex } from 'viem';
import { hashText } from '@askpay/shared/leaf';
import { LlmError, type LlmClient } from '../shared/llm.js';
import type { Logger } from '../shared/logger.js';
import { SHORT_QUOTE_HINT, SYSTEM_PROMPT } from '../modules/answer/answer.prompt.js';
import { createAnswerService } from '../modules/answer/answer.service.js';
import { JUDGE_SYSTEM_PROMPT } from '../modules/checker/checker.prompt.js';
import { createCheckerService, type VerdictSigner } from '../modules/checker/checker.service.js';
import type { CorpusService } from '../modules/corpus/corpus.service.js';
import { createRetrieval } from '../modules/retrieval/retrieval.service.js';
import type { CheckpointStore } from './checkpoint.js';
import type { EvalQuestion } from './dataset.js';
import type { CitedKhoan, QuestionRun } from './score.js';

export const DEFAULT_PACE_MS = 20_000;
// Wait before each retry of a rate-limited call: three retries, four calls in all.
export const DEFAULT_BACKOFF_MS: readonly number[] = [15_000, 30_000, 60_000];

export interface RunnerDeps {
  // The raw client. The runner wraps it for rate limits; the services never see a 429 it can absorb.
  llm: LlmClient;
  corpus: CorpusService;
  logger: Logger;
  // The checker's account and the escrow it signs for. Neither affects a number.
  signer: VerdictSigner;
  escrow: Hex;
  sleep: (ms: number) => Promise<void>;
  paceMs: number;
  backoffMs?: readonly number[];
  checkpoint: CheckpointStore;
  checkpointKey: string;
  now?: () => number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  index: number;
  total: number;
  id: string;
  outcome: QuestionRun['outcome'];
  rejectedAt?: QuestionRun['rejectedAt'];
  cited: CitedKhoan[];
  ms: number;
  resumed: boolean;
}

export interface RunResult {
  runs: QuestionRun[];
  resumed: number;
}

// What a run's numbers depend on besides the questions: the prompts. A prompt edit invalidates the
// checkpoint.
export const promptsHash = (): Hex =>
  hashText([SYSTEM_PROMPT, SHORT_QUOTE_HINT, JUDGE_SYSTEM_PROMPT].join('\n---\n'));

export const checkpointKey = (parts: {
  provider: string;
  model: string;
  questionsHash: string;
  promptsHash: string;
  corpusRoot: string;
}) =>
  [parts.provider, parts.model, parts.questionsHash, parts.promptsHash, parts.corpusRoot].join('|');

interface RateLimitState {
  exhausted: boolean;
}

// A 429 is waited out and the same call tried again. When the retries run out the error goes on to
// the service as usual, but `exhausted` stays set for the question, so it is reported as `infra`
// even if a later call of the same question got through.
function withRateLimitRetry(
  client: LlmClient,
  options: { sleep: (ms: number) => Promise<void>; backoffMs: readonly number[] },
  state: RateLimitState,
): LlmClient {
  return {
    async complete(request) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await client.complete(request);
        } catch (error) {
          const rateLimited = error instanceof LlmError && error.kind === 'rate-limited';
          if (!rateLimited) throw error;
          const wait = options.backoffMs[attempt];
          if (wait === undefined) {
            state.exhausted = true;
            throw error;
          }
          await options.sleep(wait);
        }
      }
    },
  };
}

const distinct = (cited: readonly CitedKhoan[]): CitedKhoan[] => {
  const seen = new Set<string>();
  return cited.filter(({ dieu, khoan }) => {
    const key = `${dieu}.${khoan}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function runEval(
  questions: readonly EvalQuestion[],
  deps: RunnerDeps,
): Promise<RunResult> {
  const { corpus, logger, checkpoint } = deps;
  const now = deps.now ?? (() => Date.now());
  const state: RateLimitState = { exhausted: false };
  const llm = withRateLimitRetry(
    deps.llm,
    { sleep: deps.sleep, backoffMs: deps.backoffMs ?? DEFAULT_BACKOFF_MS },
    state,
  );
  const retrieve = createRetrieval(corpus.docs());
  const answer = createAnswerService({ llm, logger });
  const checker = createCheckerService({
    llm,
    logger,
    signer: deps.signer,
    escrow: deps.escrow,
    corpus: corpus.docs(),
  });

  async function runOne(question: EvalQuestion): Promise<QuestionRun> {
    const candidates = retrieve(question.question);
    const retrievalHit = question.gold.some((gold) =>
      candidates.some((c) => c.dieu === gold.dieu && c.khoan === gold.khoan),
    );
    const base = { id: question.id, retrievalHit };

    const outcome = await answer.answer(question.question, candidates);
    if (outcome.kind === 'failed') return { ...base, outcome: 'answer-failed', cited: [] };
    if (outcome.noBasis) return { ...base, outcome: 'no-basis', cited: [] };
    if (outcome.citations.length === 0) return { ...base, outcome: 'no-citation', cited: [] };

    const cited = distinct(outcome.citations);
    const items = outcome.citations.flatMap((citation) => {
      const found = corpus.find(citation.dieu, citation.khoan);
      return found ? [{ citation, found }] : [];
    });
    // Cannot happen (citations come from retrieved Khoản), and the pipeline refunds it as
    // CHECKER_FAILED.
    if (items.length !== outcome.citations.length) {
      return { ...base, outcome: 'checker-failed', cited };
    }

    const verdict = await checker.check({
      qid: hashText(`eval-${question.id}`),
      question: question.question,
      answer: outcome.answer,
      citations: items.map(({ citation, found }) => ({
        lawId: corpus.lawId,
        dieu: citation.dieu,
        khoan: citation.khoan,
        textHash: found.textHash,
        quote: citation.quote,
      })),
    });
    // `no-citation` is unreachable (C1 ran above); the pipeline treats it as a checker failure.
    if (verdict.kind !== 'signed') return { ...base, outcome: 'checker-failed', cited };
    if (verdict.pass) return { ...base, outcome: 'passed', cited };
    return {
      ...base,
      outcome: 'rejected',
      ...(verdict.rejectedAt ? { rejectedAt: verdict.rejectedAt } : {}),
      cited,
    };
  }

  const stored = checkpoint.load();
  const done = new Map(
    stored && stored.key === deps.checkpointKey ? Object.entries(stored.runs) : [],
  );
  const saved: Record<string, QuestionRun> = Object.fromEntries(done);

  const runs: QuestionRun[] = [];
  let executed = 0;
  let resumed = 0;
  // The first exhausted question means the day's quota is gone (a minute of waiting has passed),
  // so nothing after it is sent.
  let quotaGone = false;

  for (const [position, question] of questions.entries()) {
    const event = { index: position + 1, total: questions.length, id: question.id };
    const previous = done.get(question.id);
    if (previous) {
      resumed += 1;
      runs.push(previous);
      deps.onProgress?.({ ...event, ...progressOf(previous), ms: 0, resumed: true });
      continue;
    }
    if (quotaGone) {
      const run: QuestionRun = {
        id: question.id,
        outcome: 'infra',
        cited: [],
        retrievalHit: false,
      };
      runs.push(run);
      deps.onProgress?.({ ...event, ...progressOf(run), ms: 0, resumed: false });
      continue;
    }

    if (executed > 0 && deps.paceMs > 0) await deps.sleep(deps.paceMs);
    executed += 1;
    state.exhausted = false;
    const started = now();
    const result = await runOne(question);
    const run: QuestionRun = state.exhausted
      ? { id: question.id, outcome: 'infra', cited: [], retrievalHit: false }
      : result;
    runs.push(run);

    if (run.outcome === 'infra') {
      quotaGone = true;
    } else {
      saved[run.id] = run;
      checkpoint.save({ key: deps.checkpointKey, runs: saved });
    }
    deps.onProgress?.({ ...event, ...progressOf(run), ms: now() - started, resumed: false });
  }

  return { runs, resumed };
}

function progressOf(run: QuestionRun) {
  return {
    outcome: run.outcome,
    ...(run.rejectedAt ? { rejectedAt: run.rejectedAt } : {}),
    cited: run.cited,
  };
}
