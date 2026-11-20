import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalSummarySchema, statsSchema } from '@askpay/shared/api';
import { createFileCheckpoint, writeJsonAtomic } from '../../src/eval/checkpoint.js';
import type { EvalQuestion } from '../../src/eval/dataset.js';
import {
  CHECKPOINT_PATH,
  DRAFT_PATH,
  LATEST_PATH,
  buildResult,
  decideStatus,
  formatPercent,
  formatSummary,
  isDirty,
  outputPathFor,
  readmeLine,
  type RunMeta,
  type RunStatus,
} from '../../src/eval/report.js';
import { scoreRuns, type QuestionRun } from '../../src/eval/score.js';
import { DEFAULT_EVAL_PATH } from '../../src/modules/history/history.service.js';
import { createTestApp } from '../harness.js';

const reviewed = { by: 'owner', at: '2026-11-20' };
const base = { infra: 0, reviewed, provider: 'groq', model: 'qwen/qwen3.8-27b' };

describe('AP-09-AC03 what is published, and when', () => {
  it.each<[string, Parameters<typeof decideStatus>[0], RunStatus, number]>([
    ['everything in order', base, 'final', 0],
    ['a question lost to the rate limit', { ...base, infra: 3 }, 'incomplete', 2],
    ['labels not confirmed', { ...base, reviewed: null }, 'labels-unconfirmed', 3],
    [
      'another model',
      { ...base, model: 'inclusionai/ling-3.2-flash:free' },
      'non-production-model',
      3,
    ],
    [
      'another provider, same model name',
      { ...base, provider: 'openrouter' },
      'non-production-model',
      3,
    ],
    ['infra beats unconfirmed labels', { ...base, infra: 1, reviewed: null }, 'incomplete', 2],
    ['infra beats another model', { ...base, infra: 1, model: 'x' }, 'incomplete', 2],
    ['labels beat the model', { ...base, reviewed: null, model: 'x' }, 'labels-unconfirmed', 3],
  ])('%s → %s (exit %i)', (_name, input, status, exitCode) => {
    expect(decideStatus(input)).toEqual({ status, exitCode });
  });

  it('writes only a final run to latest.json; every other status goes to draft.json', () => {
    expect(outputPathFor('final')).toBe(LATEST_PATH);
    for (const status of ['incomplete', 'labels-unconfirmed', 'non-production-model'] as const) {
      expect(outputPathFor(status)).toBe(DRAFT_PATH);
    }
    expect(DRAFT_PATH).not.toBe(LATEST_PATH);
  });

  it('writes to the very file the dashboard reads: <repo>/eval/results/latest.json', () => {
    expect(LATEST_PATH).toBe(DEFAULT_EVAL_PATH);
    expect(LATEST_PATH).toBe(resolve(import.meta.dirname, '../../../../eval/results/latest.json'));
    expect(CHECKPOINT_PATH).toBe(
      resolve(import.meta.dirname, '../../../../eval/results/.checkpoint.json'),
    );
  });

  it('keeps the draft and the checkpoint out of git', () => {
    const ignore = readFileSync(resolve(import.meta.dirname, '../../../../.gitignore'), 'utf8');
    expect(ignore).toContain('eval/results/draft.json');
    expect(ignore).toContain('eval/results/.checkpoint.json');
    expect(ignore).not.toMatch(/^eval\/results\/latest\.json/m);
  });
});

const questions: EvalQuestion[] = [
  { id: 'a', group: 'thu-viec', question: 'a', gold: [{ dieu: 25, khoan: 2 }] },
  { id: 'b', group: 'luong', question: 'b', gold: [{ dieu: 26, khoan: 0 }] },
  { id: 'c', group: 'ngoai-pham-vi', question: 'c', gold: [] },
];
const runs: QuestionRun[] = [
  { id: 'a', outcome: 'passed', cited: [{ dieu: 25, khoan: 2 }], retrievalHit: true },
  {
    id: 'b',
    outcome: 'rejected',
    rejectedAt: 'C4',
    cited: [{ dieu: 26, khoan: 0 }],
    retrievalHit: true,
  },
  { id: 'c', outcome: 'no-basis', cited: [], retrievalHit: false },
];
const meta: RunMeta = {
  runAt: '2026-11-20',
  commit: '3651d1e',
  dirty: false,
  provider: 'groq',
  model: 'qwen/qwen3.8-27b',
  corpusRoot: '0xroot',
  questionsHash: '0xq',
  promptsHash: '0xp',
  resumedFromCheckpoint: 0,
  status: 'final',
};
const scores = scoreRuns(questions, runs);

describe('AP-09-AC03 the result file', () => {
  it('has the five keys of evalSummarySchema, with the right values', () => {
    const result = buildResult(scores, meta);
    expect(evalSummarySchema.parse(result)).toEqual({
      runAt: '2026-11-20',
      commit: '3651d1e',
      citationAccuracy: 1,
      checkerPassRate: 0.5,
      outOfScopeCorrect: 1,
    });
  });

  it('carries the date, commit, dirty flag, model and how it was produced as extra keys', () => {
    const result = buildResult(scores, { ...meta, dirty: true, resumedFromCheckpoint: 4 });
    expect(result).toMatchObject({
      runAt: '2026-11-20',
      commit: '3651d1e',
      dirty: true,
      status: 'final',
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      corpusRoot: '0xroot',
      questionsHash: '0xq',
      promptsHash: '0xp',
      resumedFromCheckpoint: 4,
      retrievalRecall: 1,
      citationPrecision: 1,
    });
    expect(result.questions).toEqual([
      { id: 'a', group: 'thu-viec', outcome: 'passed', cited: ['25.2'], hit: true },
      {
        id: 'b',
        group: 'luong',
        outcome: 'rejected',
        rejectedAt: 'C4',
        cited: ['26.0'],
        hit: true,
      },
      { id: 'c', group: 'ngoai-pham-vi', outcome: 'no-basis', cited: [], hit: true },
    ]);
  });

  it('is read by the dashboard through the real history service (stats.eval is not null)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'askpay-e1-'));
    const file = join(dir, 'latest.json');
    writeJsonAtomic(file, buildResult(scores, meta));

    const test = createTestApp({ evalPath: file });
    const stats = statsSchema.parse((await test.api.get('/api/stats')).body.data);
    expect(stats.eval).toEqual({
      runAt: '2026-11-20',
      commit: '3651d1e',
      citationAccuracy: 1,
      checkerPassRate: 0.5,
      outOfScopeCorrect: 1,
    });
  });

  it('prints one line to paste into the README, with Vietnamese decimals, date and commit', () => {
    const q = Array.from({ length: 40 }, (_, i) => ({
      id: `i${i}`,
      group: 'thu-viec' as const,
      question: `i${i}`,
      gold: [{ dieu: 25, khoan: 2 }],
    }));
    const o = Array.from({ length: 10 }, (_, i) => ({
      id: `o${i}`,
      group: 'ngoai-pham-vi' as const,
      question: `o${i}`,
      gold: [],
    }));
    const r: QuestionRun[] = [
      ...q.map((x, i): QuestionRun => ({
        id: x.id,
        outcome: i < 31 ? 'passed' : 'rejected',
        cited: i < 33 ? [{ dieu: 25, khoan: 2 }] : [{ dieu: 1, khoan: 1 }],
        retrievalHit: true,
      })),
      ...o.map((x, i): QuestionRun => ({
        id: x.id,
        outcome: i < 9 ? 'no-basis' : 'no-citation',
        cited: [],
        retrievalHit: false,
      })),
    ];
    expect(readmeLine(scoreRuns([...q, ...o], r), meta)).toBe(
      'Trích đúng Khoản 82,5% (33/40) · Đạt checker 77,5% (31/40) · Ngoài phạm vi 90% (9/10) · chạy 20/11/2026 · commit 3651d1e · groq qwen/qwen3.8-27b',
    );
  });

  it('formats percentages without a trailing zero and tolerates a missing rate', () => {
    expect(formatPercent(0.825)).toBe('82,5%');
    expect(formatPercent(0.9)).toBe('90%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('n/a');
  });

  it('says plainly when a run is only a draft, and warns when the tree was dirty', () => {
    const draft = formatSummary(scores, { ...meta, status: 'non-production-model', dirty: true });
    expect(draft).toContain('BẢN NHÁP');
    expect(draft).not.toContain('Chép dòng này');
    expect(draft).toContain('CẢNH BÁO');
    const final = formatSummary(scores, meta);
    expect(final).toContain('Chép dòng này sang README');
    expect(final).not.toContain('CẢNH BÁO');
  });

  it('warns that README numbers must come from --fresh when the run reused the checkpoint', () => {
    const resumed = formatSummary(scores, { ...meta, resumedFromCheckpoint: 3 });
    expect(resumed).toContain('3 câu lấy lại từ checkpoint');
    expect(resumed).toContain('--fresh');
  });
});

describe('AP-09-AC03 dirty detection', () => {
  it('ignores eval/results/ (the run itself changes it) and nothing else', () => {
    expect(isDirty('')).toBe(false);
    expect(isDirty(' M eval/results/latest.json\n?? eval/results/draft.json\n')).toBe(false);
    expect(isDirty(' M apps/api/src/eval/runner.ts\n')).toBe(true);
    expect(isDirty(' M eval/results/latest.json\n?? eval/questions.json\n')).toBe(true);
    expect(isDirty('R  eval/results/a.json -> docs/a.json\n')).toBe(true);
    expect(isDirty('?? "eval/results/b c.json"\n')).toBe(false);
  });
});

describe('the checkpoint file', () => {
  const run: QuestionRun = {
    id: 'a',
    outcome: 'passed',
    cited: [{ dieu: 1, khoan: 2 }],
    retrievalHit: true,
  };

  it('round-trips, clears, and treats a missing, torn or foreign file as none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'askpay-e1-'));
    const path = join(dir, 'results', '.checkpoint.json');
    const store = createFileCheckpoint(path);
    expect(store.load()).toBeUndefined();

    store.save({ key: 'k', runs: { a: run } });
    expect(store.load()).toEqual({ key: 'k', runs: { a: run } });

    writeFileSync(path, '{"key": "k", "runs": {"a": {"id"');
    expect(store.load()).toBeUndefined();
    writeFileSync(path, JSON.stringify({ key: 'k', runs: { a: { id: 'a', outcome: 'fine' } } }));
    expect(store.load()).toBeUndefined();

    store.save({ key: 'k', runs: { a: run } });
    store.clear();
    expect(store.load()).toBeUndefined();
    store.clear(); // clearing nothing is fine
  });

  it('leaves no temp file behind after a write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'askpay-e1-'));
    writeJsonAtomic(join(dir, 'x.json'), { a: 1 });
    expect(readdirSync(dir)).toEqual(['x.json']);
  });
});
