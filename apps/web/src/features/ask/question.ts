import { MAX_QUESTION_LENGTH, askRequestSchema } from '@askpay/shared/api';

export type QuestionCheck =
  | { ok: true; question: string; length: number }
  | { ok: false; reason: 'empty' | 'tooLong'; length: number };

// Validates exactly as the server does (askRequestSchema: NFC, trim, 1..500), so the counter and
// the button never disagree with the API. The normalised string is what is quoted and later sent
// again unchanged (AP-03-AC04).
export function checkQuestion(raw: string): QuestionCheck {
  const normalised = raw.normalize('NFC').trim();
  const parsed = askRequestSchema.safeParse({ question: raw });
  if (parsed.success)
    return { ok: true, question: parsed.data.question, length: normalised.length };
  return {
    ok: false,
    reason: normalised.length > MAX_QUESTION_LENGTH ? 'tooLong' : 'empty',
    length: normalised.length,
  };
}
