import { questionResultSchema } from '@askpay/shared/api';
import { ERROR_CODES } from '@askpay/shared/errors';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import {
  QID,
  QUESTION,
  errorResponse,
  json,
  quoteResponse,
  resultBody,
  stubApi,
} from '../helpers/ask-api';

const get = () => apiFetch('/api/questions/x', { schema: questionResultSchema });

describe('lib/api: reads the three response shapes of apps/api', () => {
  it('returns the data of a {data} envelope', async () => {
    stubApi({ post: [], get: () => json({ data: resultBody() }) });
    expect(await get()).toMatchObject({ kind: 'data', status: 200, data: { qid: QID } });
  });

  it('tells the bare 402 quote apart from a 402 PAYMENT_INVALID error', async () => {
    stubApi({ post: [], get: () => quoteResponse() });
    expect(await get()).toMatchObject({ kind: 'paymentRequired' });
    stubApi({ post: [], get: () => errorResponse(402, 'PAYMENT_INVALID', { x: 1 }) });
    expect(await get()).toMatchObject({
      kind: 'error',
      status: 402,
      code: 'PAYMENT_INVALID',
      details: { x: 1 },
    });
  });

  it('shows the shared sentence for the code, not the text the server sent', async () => {
    stubApi({ post: [], get: () => errorResponse(503, 'CHAIN_UNAVAILABLE') });
    expect(await get()).toMatchObject({ message: ERROR_CODES.CHAIN_UNAVAILABLE.message });
  });

  it('keeps the Date header of the quote', async () => {
    const date = new Date('2026-11-15T10:00:00Z');
    stubApi({ post: [], get: () => quoteResponse({}, date) });
    const result = await get();
    expect(result.kind === 'paymentRequired' && result.headers.get('date')).toBe(
      date.toUTCString(),
    );
  });

  it('calls an HTML 502 from a proxy malformed, not a network failure', async () => {
    stubApi({ post: [], get: () => new Response('<html>Bad gateway</html>', { status: 502 }) });
    expect(await get()).toEqual({ kind: 'malformed', status: 502 });
  });

  it('calls a 200 with the wrong shape malformed', async () => {
    stubApi({ post: [], get: () => json({ data: { nope: true } }) });
    expect(await get()).toEqual({ kind: 'malformed', status: 200 });
  });

  it('turns a rejected fetch into a network result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await get()).toMatchObject({ kind: 'network' });
  });

  it('turns the client timeout into a network result', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const pending = apiFetch('/api/ask', { schema: questionResultSchema, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await pending).toMatchObject({ kind: 'network' });
    vi.useRealTimers();
  });

  it('sends the body as JSON with the extra headers', async () => {
    const api = stubApi({ post: () => json({ data: resultBody({ question: QUESTION }) }) });
    await apiFetch('/api/ask', {
      method: 'POST',
      body: { question: QUESTION },
      headers: { 'PAYMENT-SIGNATURE': 'abc' },
      schema: questionResultSchema,
    });
    expect(api.calls[0]?.headers.get('payment-signature')).toBe('abc');
    expect(api.calls[0]?.body).toEqual({ question: QUESTION });
  });
});
