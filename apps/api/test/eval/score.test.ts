import { describe, expect, it } from 'vitest';
import type { EvalQuestion } from '../../src/eval/dataset.js';
import { scoreRuns, type OutcomeKind, type QuestionRun } from '../../src/eval/score.js';

const inScope = (id: string, ...gold: [number, number][]): EvalQuestion => ({
  id,
  group: 'thu-viec',
  question: id,
  gold: gold.map(([dieu, khoan]) => ({ dieu, khoan })),
});
const outOfScope = (id: string): EvalQuestion => ({
  id,
  group: 'ngoai-pham-vi',
  question: id,
  gold: [],
});
const run = (
  id: string,
  outcome: OutcomeKind,
  cited: [number, number][] = [],
  extra: Partial<QuestionRun> = {},
): QuestionRun => ({
  id,
  outcome,
  cited: cited.map(([dieu, khoan]) => ({ dieu, khoan })),
  retrievalHit: false,
  ...extra,
});

describe('AP-09-AC02 citationAccuracy: in-scope, hit when any cited Khoản is gold', () => {
  const q = inScope('q', [25, 2]);
  it.each<[string, QuestionRun, boolean]>([
    ['passed with the gold Khoản', run('q', 'passed', [[25, 2]]), true],
    ['passed with another Khoản', run('q', 'passed', [[25, 3]]), false],
    [
      'one gold among several cited',
      run('q', 'passed', [
        [25, 3],
        [25, 2],
      ]),
      true,
    ],
    [
      'rejected but cited the gold Khoản',
      run('q', 'rejected', [[25, 2]], { rejectedAt: 'C4' }),
      true,
    ],
    ['checker-failed even with the gold Khoản', run('q', 'checker-failed', [[25, 2]]), false],
    ['no-basis', run('q', 'no-basis'), false],
    ['no-citation', run('q', 'no-citation'), false],
    ['answer-failed', run('q', 'answer-failed'), false],
  ])('%s → hit %s', (_name, result, expected) => {
    const scores = scoreRuns([q], [result]);
    expect(scores.questions[0]?.hit).toBe(expected);
    expect(scores.citationAccuracy).toMatchObject({ correct: expected ? 1 : 0, total: 1 });
  });
});

describe('AP-09-AC02 checkerPassRate: in-scope only, only `passed` counts', () => {
  it('counts every non-pass in-scope outcome in the denominator', () => {
    const questions = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => inScope(id, [25, 2]));
    const scores = scoreRuns(questions, [
      run('a', 'passed', [[25, 2]]),
      run('b', 'rejected', [[25, 2]], { rejectedAt: 'C2' }),
      run('c', 'answer-failed'),
      run('d', 'checker-failed', [[25, 2]]),
      run('e', 'no-citation'),
      run('f', 'no-basis'),
    ]);
    expect(scores.checkerPassRate).toMatchObject({ correct: 1, total: 6 });
  });

  it('keeps out-of-scope questions out of it, even one that was checked', () => {
    const scores = scoreRuns(
      [inScope('a', [25, 2]), outOfScope('o1'), outOfScope('o2')],
      [run('a', 'passed', [[25, 2]]), run('o1', 'passed', [[25, 2]]), run('o2', 'no-basis')],
    );
    expect(scores.checkerPassRate).toMatchObject({ correct: 1, total: 1 });
    expect(scores.citationAccuracy).toMatchObject({ correct: 1, total: 1 });
    expect(scores.counts).toMatchObject({ inScope: 1, outOfScope: 2 });
  });
});

describe('AP-09-AC02 outOfScopeCorrect: strict noBasis', () => {
  it('is right only for no-basis; no-citation is wrong because the user would see an answer', () => {
    const questions = ['o1', 'o2', 'o3', 'o4'].map(outOfScope);
    const scores = scoreRuns(questions, [
      run('o1', 'no-basis'),
      run('o2', 'no-citation'),
      run('o3', 'passed', [[25, 2]]),
      run('o4', 'answer-failed'),
    ]);
    expect(scores.outOfScopeCorrect).toMatchObject({ correct: 1, total: 4 });
  });
});

describe('AP-09-AC02 infra is outside every denominator and counted apart', () => {
  it('drops infra questions from all rates, groups and outcome counts', () => {
    const questions = [
      inScope('a', [25, 2]),
      inScope('b', [25, 2]),
      outOfScope('o1'),
      outOfScope('o2'),
    ];
    const scores = scoreRuns(questions, [
      run('a', 'passed', [[25, 2]]),
      run('b', 'infra'),
      run('o1', 'no-basis'),
      run('o2', 'infra'),
    ]);
    expect(scores.counts).toMatchObject({ inScope: 1, outOfScope: 1, infra: 2 });
    expect(scores.citationAccuracy).toMatchObject({ correct: 1, total: 1 });
    expect(scores.checkerPassRate).toMatchObject({ correct: 1, total: 1 });
    expect(scores.outOfScopeCorrect).toMatchObject({ correct: 1, total: 1 });
    expect(scores.byGroup['thu-viec']).toMatchObject({ n: 1 });
    const { passed, rejected, ...others } = scores.counts.byOutcome;
    const counted =
      passed +
      rejected.C2 +
      rejected.C3 +
      rejected.C4 +
      Object.values(others).reduce((a, b) => a + b, 0);
    expect(counted).toBe(2); // a and o1 only
    expect(scores.questions.find((q) => q.id === 'b')).toMatchObject({
      outcome: 'infra',
      hit: false,
    });
  });
});

describe('AP-09-AC02 the extra numbers', () => {
  it('retrievalRecall counts in-scope questions whose top-K held a gold Khoản, whatever the LLM did', () => {
    const scores = scoreRuns(
      [inScope('a', [25, 2]), inScope('b', [25, 2]), outOfScope('o')],
      [
        run('a', 'answer-failed', [], { retrievalHit: true }),
        run('b', 'passed', [[25, 2]], { retrievalHit: false }),
        run('o', 'no-basis'),
      ],
    );
    expect(scores.retrievalRecall).toMatchObject({ correct: 1, total: 2 });
  });

  it('citationPrecision is gold citations over all in-scope citations', () => {
    const scores = scoreRuns(
      [inScope('a', [25, 2]), inScope('b', [26, 0]), outOfScope('o')],
      [
        run('a', 'passed', [
          [25, 2],
          [25, 3],
        ]),
        run('b', 'passed', [[26, 0]]),
        run('o', 'passed', [[25, 2]]), // out of scope: not in the pool
      ],
    );
    expect(scores.citationPrecision).toMatchObject({ correct: 2, total: 3 });
  });

  it('counts rejections by step and breaks the rates down by group', () => {
    const questions: EvalQuestion[] = [
      { ...inScope('a', [25, 2]), group: 'luong' },
      inScope('b', [25, 2]),
      inScope('c', [25, 2]),
      outOfScope('o'),
    ];
    const scores = scoreRuns(questions, [
      run('a', 'rejected', [[25, 2]], { rejectedAt: 'C3' }),
      run('b', 'rejected', [[25, 2]], { rejectedAt: 'C4' }),
      run('c', 'passed', [[25, 2]]),
      run('o', 'no-basis'),
    ]);
    expect(scores.counts.byOutcome.rejected).toEqual({ C2: 0, C3: 1, C4: 1 });
    expect(scores.counts.byOutcome.passed).toBe(1);
    expect(scores.byGroup).toEqual({
      'thu-viec': { n: 2, citationAccuracy: 1, checkerPassRate: 0.5 },
      luong: { n: 1, citationAccuracy: 1, checkerPassRate: 0 },
      'ngoai-pham-vi': { n: 1, outOfScopeCorrect: 1 },
    });
  });

  it('gives null, not NaN, for a zero denominator', () => {
    const scores = scoreRuns([inScope('a', [25, 2])], [run('a', 'infra')]);
    expect(scores.citationAccuracy.value).toBeNull();
    expect(scores.outOfScopeCorrect.value).toBeNull();
    expect(JSON.parse(JSON.stringify(scores.checkerPassRate.value))).toBeNull();
  });

  it('refuses to score a question that has no run', () => {
    expect(() => scoreRuns([inScope('a', [25, 2])], [])).toThrow(/no run for question a/);
  });
});
