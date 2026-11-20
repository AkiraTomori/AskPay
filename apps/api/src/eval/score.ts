// What a finished question counts for (E1 design §4). Pure: the runner produces a QuestionRun per
// question, this file turns the runs into the three numbers of AP-09-AC02 and the extras.
import {
  EVAL_GROUPS,
  isOutOfScope,
  khoanKey,
  type EvalGroup,
  type EvalQuestion,
} from './dataset.js';

export type OutcomeKind =
  | 'passed'
  | 'rejected'
  | 'answer-failed'
  | 'no-basis'
  | 'no-citation'
  | 'checker-failed'
  // The eval ran out of rate-limit retries. Not the model's fault, so it is left out of every
  // denominator and counted apart.
  | 'infra';

export type RejectedAt = 'C2' | 'C3' | 'C4';

export interface CitedKhoan {
  dieu: number;
  khoan: number;
}

// What one question did, without the answer text (never stored).
export interface QuestionRun {
  id: string;
  outcome: OutcomeKind;
  rejectedAt?: RejectedAt;
  // Distinct Khoản the answer cited, whether or not the checker went on to accept them.
  cited: CitedKhoan[];
  // Did the retrieved top-K contain a gold Khoản (always false for out-of-scope: it has no gold).
  retrievalHit: boolean;
}

export interface QuestionScore {
  id: string;
  group: EvalGroup;
  outcome: OutcomeKind;
  rejectedAt?: RejectedAt;
  cited: string[];
  // In scope: a cited Khoản is in gold. Out of scope: the answer said "no basis". Never for infra.
  hit: boolean;
}

export interface Rate {
  correct: number;
  total: number;
  value: number | null;
}

export interface GroupScore {
  n: number;
  citationAccuracy?: number | null;
  checkerPassRate?: number | null;
  outOfScopeCorrect?: number | null;
}

export interface Scores {
  citationAccuracy: Rate;
  checkerPassRate: Rate;
  outOfScopeCorrect: Rate;
  retrievalRecall: Rate;
  citationPrecision: Rate;
  counts: {
    inScope: number;
    outOfScope: number;
    infra: number;
    byOutcome: {
      passed: number;
      rejected: Record<RejectedAt, number>;
      'answer-failed': number;
      'no-basis': number;
      'no-citation': number;
      'checker-failed': number;
    };
  };
  byGroup: Record<string, GroupScore>;
  questions: QuestionScore[];
}

// null, not NaN: JSON turns NaN into null anyway, and a zero denominator should be visible.
export const rate = (correct: number, total: number): Rate => ({
  correct,
  total,
  value: total === 0 ? null : correct / total,
});

const goldKeys = (question: EvalQuestion) =>
  new Set(question.gold.map(({ dieu, khoan }) => khoanKey(dieu, khoan)));

// A question that never got an answer cannot be a hit: whatever the checker did, the payer got
// nothing. A rejected one still can be: the Khoản was right, the quote or the judge was not.
function isHit(question: EvalQuestion, run: QuestionRun): boolean {
  if (run.outcome === 'infra') return false;
  if (isOutOfScope(question)) return run.outcome === 'no-basis';
  if (run.outcome === 'checker-failed') return false;
  const gold = goldKeys(question);
  return run.cited.some(({ dieu, khoan }) => gold.has(khoanKey(dieu, khoan)));
}

export function scoreRuns(
  questions: readonly EvalQuestion[],
  runs: readonly QuestionRun[],
): Scores {
  const runById = new Map(runs.map((run) => [run.id, run] as const));
  const scored: QuestionScore[] = [];
  let infra = 0;
  const byOutcome: Scores['counts']['byOutcome'] = {
    passed: 0,
    rejected: { C2: 0, C3: 0, C4: 0 },
    'answer-failed': 0,
    'no-basis': 0,
    'no-citation': 0,
    'checker-failed': 0,
  };
  const tally = { inScope: 0, outOfScope: 0, accurate: 0, passed: 0, noBasis: 0, recall: 0 };
  let citedTotal = 0;
  let citedInGold = 0;
  const groups = new Map<EvalGroup, { n: number; hits: number; passed: number }>();

  for (const question of questions) {
    const run = runById.get(question.id);
    if (!run) throw new Error(`no run for question ${question.id}`);
    const hit = isHit(question, run);
    scored.push({
      id: question.id,
      group: question.group,
      outcome: run.outcome,
      ...(run.rejectedAt ? { rejectedAt: run.rejectedAt } : {}),
      cited: run.cited.map(({ dieu, khoan }) => khoanKey(dieu, khoan)),
      hit,
    });

    if (run.outcome === 'infra') {
      infra += 1;
      continue;
    }
    if (run.outcome === 'rejected') byOutcome.rejected[run.rejectedAt ?? 'C4'] += 1;
    else byOutcome[run.outcome] += 1;

    const group = groups.get(question.group) ?? { n: 0, hits: 0, passed: 0 };
    group.n += 1;
    if (hit) group.hits += 1;
    if (run.outcome === 'passed') group.passed += 1;
    groups.set(question.group, group);

    if (isOutOfScope(question)) {
      tally.outOfScope += 1;
      if (hit) tally.noBasis += 1;
      continue; // out of scope never enters the in-scope numbers
    }
    tally.inScope += 1;
    if (hit) tally.accurate += 1;
    if (run.outcome === 'passed') tally.passed += 1;
    if (run.retrievalHit) tally.recall += 1;
    const gold = goldKeys(question);
    for (const { dieu, khoan } of run.cited) {
      citedTotal += 1;
      if (gold.has(khoanKey(dieu, khoan))) citedInGold += 1;
    }
  }

  const byGroup: Record<string, GroupScore> = {};
  for (const name of EVAL_GROUPS) {
    const group = groups.get(name);
    if (!group) continue;
    byGroup[name] =
      name === 'ngoai-pham-vi'
        ? { n: group.n, outOfScopeCorrect: rate(group.hits, group.n).value }
        : {
            n: group.n,
            citationAccuracy: rate(group.hits, group.n).value,
            checkerPassRate: rate(group.passed, group.n).value,
          };
  }

  return {
    citationAccuracy: rate(tally.accurate, tally.inScope),
    checkerPassRate: rate(tally.passed, tally.inScope),
    outOfScopeCorrect: rate(tally.noBasis, tally.outOfScope),
    retrievalRecall: rate(tally.recall, tally.inScope),
    citationPrecision: rate(citedInGold, citedTotal),
    counts: { inScope: tally.inScope, outOfScope: tally.outOfScope, infra, byOutcome },
    byGroup,
    questions: scored,
  };
}
