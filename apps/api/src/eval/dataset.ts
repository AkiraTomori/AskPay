// The eval question set (E1, AP-09-AC01): its shape and the rules it must pass before any LLM call
// is spent on it. Pure: the corpus comes in as a list of keys, so tests need no files.
import { z } from 'zod';
import { normalizeText } from '@askpay/corpus/normalize';

export const EVAL_GROUPS = [
  'thu-viec',
  'lam-them-gio',
  'nghi-viec',
  'luong',
  'ngoai-pham-vi',
] as const;
export type EvalGroup = (typeof EVAL_GROUPS)[number];
export const OUT_OF_SCOPE_GROUP: EvalGroup = 'ngoai-pham-vi';

export const MIN_QUESTIONS = 45;
export const MAX_QUESTIONS = 55;
export const MIN_PER_GROUP = 5;
// The demo flags of ask.pipeline.ts. Kept as a literal so the eval never imports the pipeline.
const DEMO_PREFIX = '#demo-';

const goldSchema = z.object({
  dieu: z.number().int().positive(),
  khoan: z.number().int().nonnegative(),
});

export const evalQuestionSchema = z.object({
  id: z.string().min(1),
  group: z.enum(EVAL_GROUPS),
  question: z.string(),
  gold: z.array(goldSchema),
});
export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export const questionSetSchema = z.object({
  // Set by the owner once the labels are confirmed (E1 design §3.3). Null: nothing is published.
  reviewed: z.object({ by: z.string().min(1), at: z.string().min(1) }).nullable(),
  questions: z.array(evalQuestionSchema),
});
export type QuestionSet = z.infer<typeof questionSetSchema>;

export const isOutOfScope = (question: Pick<EvalQuestion, 'group'>) =>
  question.group === OUT_OF_SCOPE_GROUP;

export const khoanKey = (dieu: number, khoan: number) => `${dieu}.${khoan}`;

export type ValidationResult = { ok: true; set: QuestionSet } | { ok: false; errors: string[] };

export function validateQuestionSet(
  raw: unknown,
  corpusKeys: ReadonlySet<string>,
): ValidationResult {
  const parsed = questionSetSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  const set = parsed.data;
  const errors: string[] = [];
  const { questions } = set;

  if (questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    errors.push(`expected ${MIN_QUESTIONS}-${MAX_QUESTIONS} questions, got ${questions.length}`);
  }
  for (const group of EVAL_GROUPS) {
    const count = questions.filter((question) => question.group === group).length;
    if (count < MIN_PER_GROUP) {
      errors.push(`group ${group} has ${count} questions, needs at least ${MIN_PER_GROUP}`);
    }
  }

  const ids = new Set<string>();
  const texts = new Map<string, string>();
  for (const question of questions) {
    if (ids.has(question.id)) errors.push(`${question.id}: duplicate id`);
    ids.add(question.id);

    const text = normalizeText(question.question);
    if (text.length === 0) errors.push(`${question.id}: empty question`);
    if (text.startsWith(DEMO_PREFIX)) errors.push(`${question.id}: starts with ${DEMO_PREFIX}`);
    const earlier = texts.get(text);
    if (earlier !== undefined && text.length > 0) {
      errors.push(`${question.id}: same question as ${earlier}`);
    } else {
      texts.set(text, question.id);
    }

    if (isOutOfScope(question)) {
      if (question.gold.length > 0) errors.push(`${question.id}: out-of-scope with a gold label`);
    } else if (question.gold.length === 0) {
      errors.push(`${question.id}: in-scope without a gold label`);
    }
    for (const { dieu, khoan } of question.gold) {
      if (!corpusKeys.has(khoanKey(dieu, khoan))) {
        errors.push(`${question.id}: Điều ${dieu} Khoản ${khoan} is not in the corpus`);
      }
    }
  }

  return errors.length === 0 ? { ok: true, set } : { ok: false, errors };
}
