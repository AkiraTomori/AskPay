import { fujiDeployment } from '@askpay/shared/abi';
import { vi } from 'vitest';

export const QID = `0x${'9f'.repeat(32)}` as const;
export const QUESTION = 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?';

// A 402 quote as apps/api sends it (api.md §3.1). `validBeforeIn` is seconds after the Date header.
export function quoteBody(
  overrides: { payTo?: string; asset?: string; validBefore?: number; qid?: string } = {},
) {
  return {
    x402Version: 2,
    error: 'PAYMENT_REQUIRED',
    resource: {
      url: '/api/ask',
      description: 'Một câu trả lời có trích dẫn Bộ luật Lao động 2019',
    },
    accepts: [
      {
        scheme: 'escrow',
        network: 'eip155:43113',
        asset: (overrides.asset ?? fujiDeployment.token).toLowerCase(),
        amount: '50000',
        payTo: overrides.payTo ?? fujiDeployment.address,
        maxTimeoutSeconds: 300,
        extra: {
          qid: overrides.qid ?? QID,
          authorization: 'ReceiveWithAuthorization',
          tokenName: 'USD Coin',
          tokenVersion: '2',
          validBefore: String(overrides.validBefore ?? Math.floor(Date.now() / 1000) + 300),
          answerWindowSeconds: 600,
        },
      },
    ],
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const quoteResponse = (
  overrides: Parameters<typeof quoteBody>[0] = {},
  date: Date | null = new Date(),
) => json(quoteBody(overrides), 402, date ? { date: date.toUTCString() } : {});

export const errorResponse = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: 'ignored: the web uses the shared sentence', details } }, status);

export const resultBody = (over: Record<string, unknown> = {}) => ({
  qid: QID,
  question: QUESTION,
  stage: 'QUOTED',
  ...over,
});

type Handler = (call: {
  body: Record<string, unknown>;
  headers: Headers;
}) => Response | Promise<Response>;

// A fetch that answers by route. `post` is called for POST /api/ask (quote and payment alike),
// `get` for GET /api/questions/:qid. Every call is recorded in `calls`.
export function stubApi(handlers: {
  post: Handler[] | Handler;
  get?: () => Response | Promise<Response>;
}) {
  const posts = Array.isArray(handlers.post) ? [...handlers.post] : undefined;
  const calls: { method: string; url: string; body: Record<string, unknown>; headers: Headers }[] =
    [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const headers = new Headers(init?.headers);
    calls.push({ method, url, body, headers });
    if (method === 'POST') {
      const handler = posts ? posts.shift() : (handlers.post as Handler);
      if (!handler) throw new Error('Unexpected POST in test');
      return handler({ body, headers });
    }
    if (!handlers.get) throw new Error('Unexpected GET in test');
    return handlers.get();
  });
  vi.stubGlobal('fetch', fetchMock);
  const posts_ = () => calls.filter((call) => call.method === 'POST');
  return {
    calls,
    fetchMock,
    quoteCalls: () => posts_().filter((c) => !c.headers.has('payment-signature')),
    paymentCalls: () => posts_().filter((c) => c.headers.has('payment-signature')),
  };
}
