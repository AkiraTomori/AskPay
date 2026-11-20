// `npm run eval` (E1): reads the key from the environment, runs the question set through the real
// pipeline steps, writes the result file and sets the exit code. Everything that decides what is
// published lives in report.ts; this file only touches the environment, git and the disk.
//
//   npm run eval              continue from the checkpoint if it matches
//   npm run eval -- --fresh   start over (the run that fixes the README numbers must use this)
//
// Env (from .env.poc via `node --env-file`; apps/api/.env and the checker's key are never read):
//   LLM_PROVIDER (groq), LLM_MODEL (qwen/qwen3.8-27b), LLM_API_KEY or GROQ_API_KEY / OPENROUTER_API_KEY,
//   LLM_JSON_MODE (true), EVAL_PACE_MS (20000)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fujiDeployment } from '@askpay/shared/abi';
import { hashText } from '@askpay/shared/leaf';
import { createLlmClient, type LlmConfig } from '../shared/llm.js';
import { createLogger } from '../shared/logger.js';
import { DEFAULT_CORPUS_PATH, loadCorpus } from '../modules/corpus/corpus.service.js';
import { createFileCheckpoint, writeJsonAtomic } from './checkpoint.js';
import { khoanKey, validateQuestionSet } from './dataset.js';
import {
  CHECKPOINT_PATH,
  PRODUCTION_MODEL,
  PRODUCTION_PROVIDER,
  QUESTIONS_PATH,
  buildResult,
  decideStatus,
  formatSummary,
  isDirty,
  outputPathFor,
} from './report.js';
import { DEFAULT_PACE_MS, checkpointKey, promptsHash, runEval } from './runner.js';
import { scoreRuns } from './score.js';

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readLlmConfig(): LlmConfig {
  const provider = process.env.LLM_PROVIDER ?? PRODUCTION_PROVIDER;
  if (provider !== 'groq' && provider !== 'openrouter') {
    return fail(`LLM_PROVIDER must be groq or openrouter, got "${provider}"`);
  }
  const apiKey = (
    process.env.LLM_API_KEY ??
    (provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY) ??
    ''
  ).trim();
  if (!apiKey)
    return fail(
      'set LLM_API_KEY (or GROQ_API_KEY / OPENROUTER_API_KEY) in the env file the "eval" script loads (package.json)',
    );
  return {
    provider,
    apiKey,
    model: process.env.LLM_MODEL ?? PRODUCTION_MODEL,
    jsonMode: process.env.LLM_JSON_MODE !== 'false',
  };
}

// The commit and whether anything but the results changed since. Unknown git state is reported as
// such and dirty, never as a clean commit.
function readGit(): { commit: string; dirty: boolean } {
  try {
    const run = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
    return {
      commit: run(['rev-parse', '--short', 'HEAD']).trim(),
      dirty: isDirty(run(['status', '--porcelain', '--untracked-files=all'])),
    };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh');

  // Checked before any call is made: the question set, then the key.
  const corpus = loadCorpus(DEFAULT_CORPUS_PATH);
  const questionsText = readFileSync(QUESTIONS_PATH, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(questionsText);
  } catch {
    return fail(`${QUESTIONS_PATH} is not valid JSON`);
  }
  const validation = validateQuestionSet(
    raw,
    new Set(corpus.docs().map((doc) => khoanKey(doc.dieu, doc.khoan))),
  );
  if (!validation.ok) {
    console.error('ERROR: eval/questions.json is not valid:');
    for (const error of validation.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const { set } = validation;
  const config = readLlmConfig();

  const paceMs = Number(process.env.EVAL_PACE_MS ?? DEFAULT_PACE_MS);
  const checkpoint = createFileCheckpoint(CHECKPOINT_PATH);
  if (fresh) checkpoint.clear();

  const meta = {
    questionsHash: hashText(questionsText),
    promptsHash: promptsHash(),
    corpusRoot: corpus.root,
  };
  console.log(
    `eval: ${set.questions.length} questions, ${config.provider} ${config.model}, pace ${paceMs / 1000}s${fresh ? ', --fresh' : ''}`,
  );

  const started = Date.now();
  const { runs, resumed } = await runEval(set.questions, {
    llm: createLlmClient(config),
    corpus,
    logger: createLogger(process.env.LOG_LEVEL ?? 'warn'),
    // A throwaway key: the signature does not affect a number, and the real checker key is never
    // loaded here.
    signer: privateKeyToAccount(generatePrivateKey()),
    escrow: fujiDeployment.address as Hex,
    sleep: (ms) => sleep(ms),
    paceMs,
    checkpoint,
    checkpointKey: checkpointKey({
      provider: config.provider,
      model: config.model,
      ...meta,
    }),
    onProgress(event) {
      const cited = event.cited.map(({ dieu, khoan }) => `Đ${dieu}${khoan ? `.${khoan}` : ''}`);
      const outcome = `${event.outcome}${event.rejectedAt ? ` ${event.rejectedAt}` : ''}`;
      const left = event.total - event.index;
      const eta =
        !event.resumed && left > 0
          ? ` · còn ~${Math.ceil((left * (paceMs + event.ms)) / 60_000)} phút`
          : '';
      console.log(
        `[${event.index}/${event.total}] ${event.id} ${outcome}${cited.length ? ` (${cited.join(', ')})` : ''} ${event.resumed ? '(checkpoint)' : `${Math.round(event.ms / 1000)}s${eta}`}`,
      );
    },
  });

  const scores = scoreRuns(set.questions, runs);
  const { status, exitCode } = decideStatus({
    infra: scores.counts.infra,
    reviewed: set.reviewed,
    provider: config.provider,
    model: config.model,
  });
  const git = readGit();
  const runMeta = {
    runAt: new Date().toISOString().slice(0, 10),
    ...git,
    provider: config.provider,
    model: config.model,
    ...meta,
    resumedFromCheckpoint: resumed,
    status,
  };

  const target = outputPathFor(status);
  writeJsonAtomic(target, buildResult(scores, runMeta));
  console.log(formatSummary(scores, runMeta));
  console.log(`\nĐã ghi ${target} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (status === 'incomplete') {
    const lost = scores.questions.filter((q) => q.outcome === 'infra').map((q) => q.id);
    console.log(`Hết hạn mức giữa chừng: ${lost.join(', ')}. Chạy lại để tiếp tục từ checkpoint.`);
  }
  process.exit(exitCode);
}

await main();
