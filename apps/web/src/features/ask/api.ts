import { askAcceptedSchema, questionResultSchema } from '@askpay/shared/api';
import type { AskAccepted, QuestionResult } from '@askpay/shared/api';
import { apiFetch, type ApiResult } from '@/lib/api';

// The server holds the second POST up to 60 s (REQUEST_WAIT_MS) and the Next proxy up to 75 s.
// 90 s is longer than both, so a timeout here means the connection really is gone.
export const SUBMIT_TIMEOUT_MS = 90_000;

// First call: the quote. Success is a 402 (`paymentRequired`), never a 200.
export function requestQuote(question: string): Promise<ApiResult<QuestionResult>> {
  return apiFetch('/api/ask', { method: 'POST', body: { question }, schema: questionResultSchema });
}

// Second call: the same question, the qid of the quote and the signed payment.
export function submitPayment(input: {
  question: string;
  qid: string;
  header: string;
}): Promise<ApiResult<QuestionResult | AskAccepted>> {
  return apiFetch('/api/ask', {
    method: 'POST',
    body: { question: input.question, qid: input.qid },
    headers: { 'PAYMENT-SIGNATURE': input.header },
    schema: questionResultSchema.or(askAcceptedSchema),
    timeoutMs: SUBMIT_TIMEOUT_MS,
  });
}

export function getQuestion(qid: string): Promise<ApiResult<QuestionResult>> {
  return apiFetch(`/api/questions/${qid}`, { schema: questionResultSchema });
}
