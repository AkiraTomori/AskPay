import { questionListItemSchema, statsSchema } from '@askpay/shared/api';
import type { QuestionListItem, Stats } from '@askpay/shared/api';
import type { ErrorCode } from '@askpay/shared/errors';
import { apiFetch, type ApiResult } from '@/lib/api';

export const PAGE_SIZE = 20;

export type QuestionPage = { items: QuestionListItem[]; nextCursor: string | undefined };

// What a failed read carries to the view: the API error code (if the server sent one), so the
// view can show the RATE_LIMITED sentence and a generic one for everything else.
export class LoadError extends Error {
  constructor(readonly code: ErrorCode | undefined) {
    super(code ?? 'load failed');
  }
}

function unwrap<T>(result: ApiResult<T>): { data: T; meta: unknown } {
  if (result.kind === 'data') return { data: result.data, meta: result.meta };
  throw new LoadError(result.kind === 'error' ? result.code : undefined);
}

export async function getStats(): Promise<Stats> {
  return unwrap(await apiFetch('/api/stats', { schema: statsSchema })).data;
}

export async function getQuestions(cursor?: string): Promise<QuestionPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor !== undefined) query.set('cursor', cursor);
  const { data, meta } = unwrap(
    await apiFetch(`/api/questions?${query}`, { schema: questionListItemSchema.array() }),
  );
  const next = (meta as { nextCursor?: unknown } | null | undefined)?.nextCursor;
  return { items: data, nextCursor: typeof next === 'string' && next !== '' ? next : undefined };
}
