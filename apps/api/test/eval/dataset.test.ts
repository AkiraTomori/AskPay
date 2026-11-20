import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EVAL_GROUPS,
  khoanKey,
  validateQuestionSet,
  type EvalQuestion,
} from '../../src/eval/dataset.js';
import { QUESTIONS_PATH } from '../../src/eval/report.js';
import { corpus } from '../harness.js';

const realKeys = new Set(corpus.docs().map((doc) => khoanKey(doc.dieu, doc.khoan)));
const fakeKeys = new Set(['25.2', '26.0']);

// 10 per group, all distinct: the smallest set that passes.
function validQuestions(): EvalQuestion[] {
  return EVAL_GROUPS.flatMap((group) =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `${group}-${i}`,
      group,
      question: `Câu hỏi số ${i} của nhóm ${group}?`,
      gold: group === 'ngoai-pham-vi' ? [] : [{ dieu: 25, khoan: 2 }],
    })),
  );
}
const setOf = (questions: EvalQuestion[]) => ({ reviewed: null, questions });
const errorsOf = (questions: unknown, keys = fakeKeys) => {
  const result = validateQuestionSet({ reviewed: null, questions }, keys);
  return result.ok ? [] : result.errors;
};

describe('AP-09-AC01 the real question set', () => {
  const raw: unknown = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
  const result = validateQuestionSet(raw, realKeys);

  it('passes the validator against the real corpus', () => {
    expect(result).toEqual({ ok: true, set: expect.anything() });
  });

  it('has about 50 questions over the five groups, every gold Khoản in the corpus', () => {
    if (!result.ok) throw new Error(result.errors.join('; '));
    const { questions } = result.set;
    expect(questions.length).toBeGreaterThanOrEqual(45);
    expect(questions.length).toBeLessThanOrEqual(55);
    expect(new Set(questions.map((q) => q.group))).toEqual(new Set(EVAL_GROUPS));
    for (const question of questions) {
      for (const { dieu, khoan } of question.gold) {
        expect(realKeys.has(khoanKey(dieu, khoan))).toBe(true);
      }
    }
  });

  it('has an empty gold exactly for the out-of-scope group, and no #demo- question', () => {
    if (!result.ok) throw new Error(result.errors.join('; '));
    for (const question of result.set.questions) {
      expect(question.gold.length === 0).toBe(question.group === 'ngoai-pham-vi');
      expect(question.question.startsWith('#demo-')).toBe(false);
    }
  });
});

describe('AP-09-AC01 each rule of the validator fails on its own', () => {
  it('accepts the baseline', () => {
    expect(validateQuestionSet(setOf(validQuestions()), fakeKeys).ok).toBe(true);
  });

  it('rejects too few and too many questions', () => {
    expect(errorsOf(validQuestions().slice(0, 40)).join()).toMatch(/expected 45-55/);
    const extra = Array.from({ length: 6 }, (_, i) => ({
      id: `x${i}`,
      group: 'luong' as const,
      question: `Câu thêm ${i}?`,
      gold: [{ dieu: 25, khoan: 2 }],
    }));
    expect(errorsOf([...validQuestions(), ...extra]).join()).toMatch(/expected 45-55/);
  });

  it('rejects a group under 5 questions', () => {
    const questions = validQuestions().filter((q) => !(q.group === 'luong' && q.id > 'luong-3'));
    const padded = [
      ...questions,
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`,
        group: 'thu-viec' as const,
        question: `Câu đệm ${i}?`,
        gold: [{ dieu: 25, khoan: 2 }],
      })),
    ];
    expect(errorsOf(padded).join()).toMatch(/group luong has 4/);
  });

  it('rejects a duplicate id and a group outside the five', () => {
    const questions = validQuestions();
    const [first, second] = questions;
    if (!first || !second) throw new Error('baseline too small');
    second.id = first.id;
    expect(errorsOf(questions).join()).toMatch(/duplicate id/);
    expect(
      errorsOf(validQuestions().map((q, i) => (i === 0 ? { ...q, group: 'khac' } : q))),
    ).not.toEqual([]);
  });

  it('rejects an in-scope question without gold and an out-of-scope one with gold', () => {
    const questions = validQuestions();
    const inScope = questions.find((q) => q.group === 'luong');
    const outOfScope = questions.find((q) => q.group === 'ngoai-pham-vi');
    if (!inScope || !outOfScope) throw new Error('baseline too small');
    inScope.gold = [];
    outOfScope.gold = [{ dieu: 25, khoan: 2 }];
    const errors = errorsOf(questions).join();
    expect(errors).toContain(`${inScope.id}: in-scope without a gold label`);
    expect(errors).toContain(`${outOfScope.id}: out-of-scope with a gold label`);
  });

  it('rejects a gold Khoản that is not in the corpus', () => {
    const questions = validQuestions();
    const target = questions.find((q) => q.group === 'luong');
    if (!target) throw new Error('baseline too small');
    target.gold = [{ dieu: 999, khoan: 1 }];
    expect(errorsOf(questions).join()).toContain('Điều 999 Khoản 1 is not in the corpus');
  });

  it('rejects an empty question, a #demo- question and a duplicate after normalising', () => {
    const questions = validQuestions();
    const [a, b, c, d] = questions;
    if (!a || !b || !c || !d) throw new Error('baseline too small');
    a.question = '   ';
    b.question = '#demo-fake hỏi thử';
    c.question = 'Thử việc tối đa bao lâu?';
    d.question = '  Thử   việc tối đa\nbao lâu?  ';
    const errors = errorsOf(questions).join();
    expect(errors).toContain(`${a.id}: empty question`);
    expect(errors).toContain(`${b.id}: starts with #demo-`);
    expect(errors).toContain(`${d.id}: same question as ${c.id}`);
  });

  it('rejects a file that is not the expected shape, without throwing', () => {
    expect(validateQuestionSet({ questions: 'no' }, fakeKeys).ok).toBe(false);
    expect(validateQuestionSet(null, fakeKeys).ok).toBe(false);
  });
});
