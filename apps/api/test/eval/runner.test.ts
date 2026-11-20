import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { hashText } from '@askpay/shared/leaf';
import { JUDGE_SYSTEM_PROMPT } from '../../src/modules/checker/checker.prompt.js';
import { createRetrieval } from '../../src/modules/retrieval/retrieval.service.js';
import type { Checkpoint, CheckpointStore } from '../../src/eval/checkpoint.js';
import { khoanKey, type EvalQuestion } from '../../src/eval/dataset.js';
import { checkpointKey, runEval, type RunnerDeps } from '../../src/eval/runner.js';
import { scoreRuns } from '../../src/eval/score.js';
import { LlmError, type LlmClient, type LlmRequest } from '../../src/shared/llm.js';
import { createLogger } from '../../src/shared/logger.js';
import { checker, corpus } from '../harness.js';

// --- A scripted model --------------------------------------------------------------------------
// The real answer and checker services run against it. It picks what to do from the question that
// appears in the prompt, and quotes the real candidate text, so C2 holds on the real corpus.

type AnswerMove = 'cite-1' | 'cite-2' | 'no-basis' | 'no-citation' | 'bad-quote' | 'garbage';
type JudgeMove = 'yes' | 'no' | 'garbage';
interface Move {
  answer: AnswerMove;
  judge?: JudgeMove;
}

const candidatesIn = (user: string) =>
  [...user.matchAll(/\[(C\d+)\] Điều (\d+)(?: Khoản (\d+))? \([^)]*\): (.+)/g)].map((m) => ({
    id: m[1] ?? '',
    text: m[4] ?? '',
  }));

function scriptedLlm(script: Record<string, Move>) {
  const calls: LlmRequest[] = [];
  const moveFor = (user: string) => {
    const question = Object.keys(script).find((q) => user.includes(q));
    const move = question ? script[question] : undefined;
    if (!move) throw new Error(`no scripted move for: ${user.slice(0, 80)}`);
    return move;
  };
  const respond = (request: LlmRequest): string => {
    const move = moveFor(request.user);
    if (request.system === JUDGE_SYSTEM_PROMPT) {
      if (move.judge === 'garbage') return 'not json';
      const count = (request.user.match(/^\[K\d+\]/gm) ?? []).length;
      return JSON.stringify({
        judgements: Array.from({ length: count }, (_, i) => ({
          id: `K${i + 1}`,
          relevant: move.judge ?? 'yes',
        })),
      });
    }
    const candidates = candidatesIn(request.user);
    const cite = (position: number, quote?: string) => {
      const candidate = candidates[position];
      if (!candidate) return JSON.stringify({ noBasis: true, answer: '', citations: [] });
      return JSON.stringify({
        noBasis: false,
        answer: 'Trả lời theo văn bản.',
        citations: [{ candidateId: candidate.id, quote: quote ?? candidate.text.slice(0, 60) }],
      });
    };
    switch (move.answer) {
      case 'cite-1':
        return cite(0);
      case 'cite-2':
        return cite(1);
      case 'bad-quote':
        return cite(0, 'một đoạn văn không hề có trong luật lao động');
      case 'no-citation':
        return JSON.stringify({ noBasis: false, answer: 'Có.', citations: [] });
      case 'no-basis':
        return JSON.stringify({ noBasis: true, answer: '', citations: [] });
      case 'garbage':
        return 'not json';
    }
  };
  const llm: LlmClient = {
    complete: vi.fn(async (request: LlmRequest) => {
      calls.push(request);
      return respond(request);
    }),
  };
  return { llm, calls };
}

// Wraps a client so chosen calls (by 0-based index) throw instead.
function flaky(
  inner: LlmClient,
  failWith: (callIndex: number) => LlmError | undefined,
): { llm: LlmClient; attempts: () => number } {
  let index = 0;
  return {
    llm: {
      async complete(request) {
        const error = failWith(index);
        index += 1;
        if (error) throw error;
        return inner.complete(request);
      },
    },
    attempts: () => index,
  };
}

function memoryCheckpoint(initial?: Checkpoint): CheckpointStore & { saves: number } {
  let current = initial;
  const store = {
    saves: 0,
    load: () => current,
    save(value: Checkpoint) {
      current = structuredClone(value);
      store.saves += 1;
    },
    clear() {
      current = undefined;
    },
  };
  return store;
}

// --- The question set --------------------------------------------------------------------------

const retrieve = createRetrieval(corpus.docs());
const top = (text: string, position: number) => {
  const candidate = retrieve(text)[position];
  if (!candidate) throw new Error(`no candidate ${position} for ${text}`);
  return { dieu: candidate.dieu, khoan: candidate.khoan };
};
const T = {
  q1: 'Thời gian thử việc tối đa bao nhiêu ngày?',
  q2: 'Lương thử việc tối thiểu là bao nhiêu?',
  q3: 'Làm thêm giờ vào ngày lễ được trả lương thế nào?',
  q4: 'Muốn nghỉ việc phải báo trước bao lâu?',
  q5: 'Người lao động nghỉ phép năm mấy ngày?',
  q6: 'Hợp đồng lao động có những loại nào?',
  q7: 'Thuế thu nhập cá nhân tính thế nào?',
  q8: 'Mua bán nhà đất cần giấy tờ gì?',
};

// A Khoản that retrieval will not return for any of these questions.
const FAR = (() => {
  const near = new Set(
    Object.values(T).flatMap((q) => retrieve(q).map((c) => khoanKey(c.dieu, c.khoan))),
  );
  const doc = corpus.docs().find((d) => !near.has(khoanKey(d.dieu, d.khoan)));
  if (!doc) throw new Error('every Khoản was retrieved');
  return { dieu: doc.dieu, khoan: doc.khoan };
})();

const question = (
  key: keyof typeof T,
  group: EvalQuestion['group'],
  gold: { dieu: number; khoan: number }[],
): EvalQuestion => ({ id: key, group, question: T[key], gold });

const questions: EvalQuestion[] = [
  question('q1', 'thu-viec', [top(T.q1, 0)]),
  question('q2', 'luong', [FAR]),
  question('q3', 'lam-them-gio', [top(T.q3, 1)]),
  question('q4', 'nghi-viec', [top(T.q4, 0)]),
  question('q5', 'nghi-viec', [top(T.q5, 0)]),
  question('q6', 'nghi-viec', [top(T.q6, 0)]),
  question('q7', 'ngoai-pham-vi', []),
  question('q8', 'ngoai-pham-vi', []),
];

const script: Record<string, Move> = {
  [T.q1]: { answer: 'cite-1', judge: 'yes' }, // passed, gold cited
  [T.q2]: { answer: 'cite-1', judge: 'yes' }, // passed, gold not cited
  [T.q3]: { answer: 'cite-2', judge: 'yes' }, // passed, gold is the second candidate
  [T.q4]: { answer: 'cite-1', judge: 'no' }, // rejected at C4, still the gold Khoản
  [T.q5]: { answer: 'bad-quote' }, // rejected at C2
  [T.q6]: { answer: 'no-basis' }, // in scope, the model gave up
  [T.q7]: { answer: 'no-basis' }, // out of scope, right
  [T.q8]: { answer: 'no-citation' }, // out of scope, wrong
};

const KEY = checkpointKey({
  provider: 'groq',
  model: 'm',
  questionsHash: 'q',
  promptsHash: 'p',
  corpusRoot: 'r',
});

function deps(overrides: Partial<RunnerDeps> & { llm: LlmClient }): RunnerDeps & {
  sleeps: number[];
} {
  const sleeps: number[] = [];
  return {
    corpus,
    logger: createLogger('silent'),
    signer: checker,
    escrow: '0x869e95576f6dd6f06118cf733b4f307ae37ddce0',
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    paceMs: 1_000,
    checkpoint: memoryCheckpoint(),
    checkpointKey: KEY,
    ...overrides,
    sleeps,
  };
}

describe('AP-09-AC02 the runner on a scripted model', () => {
  it('turns a fixed set into the numbers worked out by hand', async () => {
    const { llm } = scriptedLlm(script);
    const { runs, resumed } = await runEval(questions, deps({ llm }));

    expect(resumed).toBe(0);
    expect(runs.map((r) => [r.id, r.outcome, r.rejectedAt])).toEqual([
      ['q1', 'passed', undefined],
      ['q2', 'passed', undefined],
      ['q3', 'passed', undefined],
      ['q4', 'rejected', 'C4'],
      ['q5', 'rejected', 'C2'],
      ['q6', 'no-basis', undefined],
      ['q7', 'no-basis', undefined],
      ['q8', 'no-citation', undefined],
    ]);
    const scores = scoreRuns(questions, runs);
    // In scope q1..q6: gold cited in q1, q3, q4 (rejected, still right), q5 (bad quote, right Khoản).
    expect(scores.citationAccuracy).toMatchObject({ correct: 4, total: 6 });
    expect(scores.checkerPassRate).toMatchObject({ correct: 3, total: 6 });
    expect(scores.outOfScopeCorrect).toMatchObject({ correct: 1, total: 2 });
    expect(scores.counts.infra).toBe(0);
    // q2's gold is far from anything retrieved; q6 is not retrieval's fault.
    expect(scores.retrievalRecall).toMatchObject({ correct: 5, total: 6 });
  });

  it('never stores the answer text, only outcome and what was cited', async () => {
    const { llm } = scriptedLlm(script);
    const store = memoryCheckpoint();
    const { runs } = await runEval(questions, deps({ llm, checkpoint: store }));
    const stored = JSON.stringify([runs, store.load()]);
    expect(stored).not.toContain('Trả lời theo văn bản');
    expect(Object.keys(runs[0] ?? {}).sort()).toEqual(['cited', 'id', 'outcome', 'retrievalHit']);
  });

  it('classifies a garbled answer as answer-failed and an unusable judge as checker-failed', async () => {
    const { llm } = scriptedLlm({
      [T.q1]: { answer: 'garbage' },
      [T.q2]: { answer: 'cite-1', judge: 'garbage' },
    });
    const { runs } = await runEval(questions.slice(0, 2), deps({ llm }));
    expect(runs.map((r) => r.outcome)).toEqual(['answer-failed', 'checker-failed']);
    expect(runs[1]?.cited).toHaveLength(1);
    expect(scoreRuns(questions.slice(0, 2), runs).citationAccuracy.correct).toBe(0);
  });

  it('keeps timeouts as model failures: only rate limits are infra', async () => {
    const { llm: inner } = scriptedLlm(script);
    const { llm } = flaky(inner, () => new LlmError('timeout'));
    const { runs } = await runEval(questions.slice(0, 2), deps({ llm }));
    expect(runs.map((r) => r.outcome)).toEqual(['answer-failed', 'answer-failed']);
  });

  it('sleeps the pace between questions that were run, not before the first', async () => {
    const { llm } = scriptedLlm(script);
    const d = deps({ llm, paceMs: 7_000 });
    await runEval(questions.slice(0, 3), d);
    expect(d.sleeps).toEqual([7_000, 7_000]);
  });

  it('reports each question as it finishes', async () => {
    const { llm } = scriptedLlm(script);
    const onProgress = vi.fn();
    await runEval(questions.slice(0, 2), deps({ llm, onProgress }));
    expect(onProgress.mock.calls.map(([e]) => [e.index, e.total, e.id, e.outcome])).toEqual([
      [1, 2, 'q1', 'passed'],
      [2, 2, 'q2', 'passed'],
    ]);
  });
});

describe('AP-09-AC02 rate limits (429)', () => {
  it('waits 15 s then 30 s and succeeds on the third try: not infra', async () => {
    const { llm: inner } = scriptedLlm(script);
    const { llm } = flaky(inner, (i) => (i < 2 ? new LlmError('rate-limited', 429) : undefined));
    const d = deps({ llm, paceMs: 0 });
    const { runs } = await runEval(questions.slice(0, 1), d);
    expect(runs[0]?.outcome).toBe('passed');
    expect(d.sleeps).toEqual([15_000, 30_000]);
  });

  it('is infra after three retries, and everything after it is infra without a call', async () => {
    const { llm: inner } = scriptedLlm(script);
    const { llm, attempts } = flaky(inner, () => new LlmError('rate-limited', 429));
    const d = deps({ llm, paceMs: 0 });
    const { runs } = await runEval(questions.slice(0, 4), d);

    expect(runs.map((r) => r.outcome)).toEqual(['infra', 'infra', 'infra', 'infra']);
    // The answer service retries once more, so two rounds of 4 calls and 3 waits each.
    expect(attempts()).toBe(8);
    expect(d.sleeps).toEqual([15_000, 30_000, 60_000, 15_000, 30_000, 60_000]);
  });

  it('stays infra when a later call of the same question got through', async () => {
    const { llm: inner } = scriptedLlm(script);
    // The first answer call is rate limited four times (exhausted); the service's retry succeeds.
    const { llm } = flaky(inner, (i) => (i < 4 ? new LlmError('rate-limited', 429) : undefined));
    const { runs } = await runEval(questions.slice(0, 2), deps({ llm, paceMs: 0 }));
    expect(runs.map((r) => r.outcome)).toEqual(['infra', 'infra']);
  });

  it('does not checkpoint an infra question, and a rerun continues from the finished ones', async () => {
    const { llm: inner } = scriptedLlm(script);
    const store = memoryCheckpoint();
    // Quota is gone from the 4th question's first call on (2 calls per finished question).
    const { llm: limited } = flaky(inner, (i) =>
      i >= 6 ? new LlmError('rate-limited', 429) : undefined,
    );
    const first = await runEval(questions.slice(0, 5), deps({ llm: limited, checkpoint: store }));
    expect(first.runs.map((r) => r.outcome)).toEqual([
      'passed',
      'passed',
      'passed',
      'infra',
      'infra',
    ]);
    expect(Object.keys(store.load()?.runs ?? {})).toEqual(['q1', 'q2', 'q3']);

    const counted = scriptedLlm(script);
    const second = await runEval(
      questions.slice(0, 5),
      deps({ llm: counted.llm, checkpoint: store }),
    );
    expect(second.resumed).toBe(3);
    expect(second.runs.map((r) => r.outcome)).toEqual([
      'passed',
      'passed',
      'passed',
      'rejected',
      'rejected',
    ]);
    // Only q4 and q5 were asked: answer + judge for q4, answer only for q5 (it fails C2).
    expect(counted.calls).toHaveLength(3);
  });
});

describe('AP-09-AC02 checkpoint', () => {
  it('reuses every finished question and makes no call, with no pacing for them', async () => {
    const store = memoryCheckpoint();
    const first = scriptedLlm(script);
    const firstRun = await runEval(questions, deps({ llm: first.llm, checkpoint: store }));

    const second = scriptedLlm(script);
    const d = deps({ llm: second.llm, checkpoint: store });
    const secondRun = await runEval(questions, d);
    expect(second.calls).toHaveLength(0);
    expect(d.sleeps).toEqual([]);
    expect(secondRun.resumed).toBe(questions.length);
    expect(secondRun.runs).toEqual(firstRun.runs);
  });

  it('is dropped when the key differs (another model, prompt, question set or corpus)', async () => {
    const store = memoryCheckpoint();
    await runEval(questions.slice(0, 2), deps({ llm: scriptedLlm(script).llm, checkpoint: store }));

    const other = scriptedLlm(script);
    const result = await runEval(
      questions.slice(0, 2),
      deps({ llm: other.llm, checkpoint: store, checkpointKey: `${KEY}-changed` }),
    );
    expect(result.resumed).toBe(0);
    expect(other.calls.length).toBeGreaterThan(0);
  });

  it('writes after every finished question, so Ctrl+C loses at most the one in flight', async () => {
    const store = memoryCheckpoint();
    await runEval(questions.slice(0, 3), deps({ llm: scriptedLlm(script).llm, checkpoint: store }));
    expect(store.saves).toBe(3);
  });

  it('builds the key from provider, model, questions, prompts and corpus root', () => {
    const base = {
      provider: 'groq',
      model: 'm',
      questionsHash: 'q',
      promptsHash: 'p',
      corpusRoot: 'r',
    };
    const keys = new Set([
      checkpointKey(base),
      checkpointKey({ ...base, provider: 'openrouter' }),
      checkpointKey({ ...base, model: 'n' }),
      checkpointKey({ ...base, questionsHash: 'x' }),
      checkpointKey({ ...base, promptsHash: 'x' }),
      checkpointKey({ ...base, corpusRoot: 'x' }),
    ]);
    expect(keys.size).toBe(6);
  });
});

describe('AP-09-AC02 the signer is a throwaway and nothing is paid', () => {
  it('signs with whatever key it is handed and still counts a pass', async () => {
    const throwaway = privateKeyToAccount(hashText('throwaway'));
    const { llm } = scriptedLlm(script);
    const { runs } = await runEval(questions.slice(0, 1), deps({ llm, signer: throwaway }));
    expect(runs[0]?.outcome).toBe('passed');
  });
});
