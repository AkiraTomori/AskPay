// What a finished run turns into: its status, the JSON file, the README line, the console table
// (E1 design §5, §6). Pure, so the rules that decide what is published are tested without a run.
import { dirname, join } from 'node:path';
import type { QuestionSet } from './dataset.js';
import type { Rate, Scores } from './score.js';

// Q-01: the model the numbers must come from to be published.
export const PRODUCTION_PROVIDER = 'groq';
export const PRODUCTION_MODEL = 'qwen/qwen3.8-27b';

// The file the dashboard reads (history.service DEFAULT_EVAL_PATH). It is spelled out here, not
// imported, because history.service pulls in the payment module and the eval must not; a test keeps
// the two equal.
export const LATEST_PATH = new URL('../../../../eval/results/latest.json', import.meta.url)
  .pathname;
const EVAL_DIR = dirname(dirname(LATEST_PATH));
export const RESULTS_DIR = dirname(LATEST_PATH);
export const DRAFT_PATH = join(RESULTS_DIR, 'draft.json');
export const CHECKPOINT_PATH = join(RESULTS_DIR, '.checkpoint.json');
export const QUESTIONS_PATH = join(EVAL_DIR, 'questions.json');

export type RunStatus = 'final' | 'incomplete' | 'labels-unconfirmed' | 'non-production-model';

// latest.json is replaced only by a final run: a failed run never costs the previous result.
export const outputPathFor = (status: RunStatus) => (status === 'final' ? LATEST_PATH : DRAFT_PATH);

export interface StatusInput {
  infra: number;
  reviewed: QuestionSet['reviewed'];
  provider: string;
  model: string;
}

// Precedence when several hold: lost to quota first (the run must be repeated anyway), then labels,
// then model. Exit 0 only for `final`; 2 means "run again", 3 means "will never be published as is".
export function decideStatus(input: StatusInput): { status: RunStatus; exitCode: 0 | 2 | 3 } {
  if (input.infra > 0) return { status: 'incomplete', exitCode: 2 };
  if (!input.reviewed) return { status: 'labels-unconfirmed', exitCode: 3 };
  if (input.provider !== PRODUCTION_PROVIDER || input.model !== PRODUCTION_MODEL) {
    return { status: 'non-production-model', exitCode: 3 };
  }
  return { status: 'final', exitCode: 0 };
}

// `git status --porcelain --untracked-files=all`: dirty when anything outside eval/results/ differs
// from the commit, because only that code or data could have changed the numbers.
export function isDirty(porcelain: string): boolean {
  return porcelain
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .some((line) =>
      line
        .slice(3)
        .split(' -> ')
        .some((path) => !path.replace(/^"|"$/g, '').startsWith('eval/results/')),
    );
}

export interface RunMeta {
  runAt: string;
  commit: string;
  dirty: boolean;
  provider: string;
  model: string;
  corpusRoot: string;
  questionsHash: string;
  promptsHash: string;
  resumedFromCheckpoint: number;
  status: RunStatus;
}

// The first five keys are evalSummarySchema (what the dashboard reads); the rest are extras the
// schema drops. A zero denominator is null, never NaN.
export function buildResult(scores: Scores, meta: RunMeta) {
  return {
    runAt: meta.runAt,
    commit: meta.commit,
    citationAccuracy: scores.citationAccuracy.value,
    checkerPassRate: scores.checkerPassRate.value,
    outOfScopeCorrect: scores.outOfScopeCorrect.value,
    status: meta.status,
    dirty: meta.dirty,
    provider: meta.provider,
    model: meta.model,
    corpusRoot: meta.corpusRoot,
    questionsHash: meta.questionsHash,
    promptsHash: meta.promptsHash,
    resumedFromCheckpoint: meta.resumedFromCheckpoint,
    counts: scores.counts,
    retrievalRecall: scores.retrievalRecall.value,
    citationPrecision: scores.citationPrecision.value,
    byGroup: scores.byGroup,
    questions: scores.questions,
  };
}

// 0.825 → "82,5%", 0.9 → "90%": Vietnamese decimal comma, no trailing zero.
export function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${(value * 100).toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
}

const formatRate = (rate: Rate) => `${formatPercent(rate.value)} (${rate.correct}/${rate.total})`;

// "2026-11-20" → "20/11/2026"
const formatDate = (iso: string) => iso.split('-').reverse().join('/');

// The one line the owner pastes into the README and the slides, so all three places agree (§6).
export function readmeLine(scores: Scores, meta: RunMeta): string {
  return [
    `Trích đúng Khoản ${formatRate(scores.citationAccuracy)}`,
    `Đạt checker ${formatRate(scores.checkerPassRate)}`,
    `Ngoài phạm vi ${formatRate(scores.outOfScopeCorrect)}`,
    `chạy ${formatDate(meta.runAt)}`,
    `commit ${meta.commit}${meta.dirty ? ' (dirty)' : ''}`,
    `${meta.provider} ${meta.model}`,
  ].join(' · ');
}

export function formatSummary(scores: Scores, meta: RunMeta): string {
  const { counts } = scores;
  const outcomes = counts.byOutcome;
  const lines = [
    '',
    `Trích đúng Khoản  ${formatRate(scores.citationAccuracy)}`,
    `Đạt checker       ${formatRate(scores.checkerPassRate)}`,
    `Ngoài phạm vi     ${formatRate(scores.outOfScopeCorrect)}`,
    `(phụ) retrieval recall ${formatRate(scores.retrievalRecall)} · citation precision ${formatRate(scores.citationPrecision)}`,
    `Outcome: passed ${outcomes.passed} · rejected C2 ${outcomes.rejected.C2} C3 ${outcomes.rejected.C3} C4 ${outcomes.rejected.C4} · no-basis ${outcomes['no-basis']} · no-citation ${outcomes['no-citation']} · answer-failed ${outcomes['answer-failed']} · checker-failed ${outcomes['checker-failed']} · infra ${counts.infra}`,
  ];
  if (meta.status === 'final') {
    lines.push('', 'Chép dòng này sang README và slide:', readmeLine(scores, meta));
  } else {
    lines.push('', `Trạng thái ${meta.status}: ĐÂY LÀ BẢN NHÁP, không chép vào README.`);
  }
  if (meta.resumedFromCheckpoint > 0) {
    lines.push(
      '',
      `CẢNH BÁO: ${meta.resumedFromCheckpoint} câu lấy lại từ checkpoint, không chạy mới. Số trên README/slide phải lấy từ lần chạy --fresh.`,
    );
  }
  if (meta.dirty) {
    lines.push(
      '',
      'CẢNH BÁO: working tree có thay đổi chưa commit ngoài eval/results/. Số trên README/slide nên lấy từ lần chạy dirty=false.',
    );
  }
  return lines.join('\n');
}
