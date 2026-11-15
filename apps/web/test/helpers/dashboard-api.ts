import { vi } from 'vitest';
import { json, SETTLE_TX } from './ask-api';

// A GET /api/stats body as api.md §6 shows it (all five reasons: the schema's record is exhaustive).
export const statsBody = (over: Record<string, unknown> = {}) => ({
  questions: 42,
  paid: 31,
  refunded: 11,
  refundRate: 0.262,
  refundsByReason: {
    NO_CITATION: 6,
    INVALID_CITATION: 1,
    CHECKER_REJECTED: 3,
    ANSWER_FAILED: 0,
    TIMEOUT: 1,
  },
  providerRevenue: '1550000',
  lastIndexedBlock: 38123456,
  eval: null,
  ...over,
});

export const EVAL = {
  runAt: '2026-11-18',
  commit: 'abc1234',
  citationAccuracy: 0.82,
  checkerPassRate: 0.78,
  outOfScopeCorrect: 0.9,
};

export const qid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

// One row of GET /api/questions. `n` makes the qid and the time unique and ordered (newer first).
export const rowBody = (n: number, over: Record<string, unknown> = {}) => ({
  qid: qid(n),
  question: `Câu hỏi số ${n}`,
  status: 'PAID',
  reason: null,
  amount: '50000',
  createdAt: Date.UTC(2026, 10, 15, 14, 40) - n * 60_000,
  tx: { settle: SETTLE_TX },
  ...over,
});

export const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => rowBody(from + i));

export type Reply = Response | Record<string, unknown>;

// Routes by URL (`stubApi` cannot: its `get` sees no arguments). `questions` is called with the
// cursor, or undefined for page 1. Every call is recorded in `urls`.
export function stubDashboardApi(handlers: {
  stats?: () => Reply | Promise<Reply>;
  questions?: (cursor: string | undefined) => Reply | Promise<Reply>;
}) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    urls.push(url);
    const parsed = new URL(url, 'http://localhost');
    const reply =
      parsed.pathname === '/api/stats'
        ? await handlers.stats?.()
        : await handlers.questions?.(parsed.searchParams.get('cursor') ?? undefined);
    if (reply === undefined) throw new Error(`Unexpected GET ${url}`);
    return reply instanceof Response ? reply : json(reply);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    urls,
    count: (path: string) => urls.filter((u) => u.startsWith(path)).length,
  };
}

export const statsReply = (over: Record<string, unknown> = {}) => ({ data: statsBody(over) });
export const listReply = (items: unknown[], nextCursor?: string) => ({
  data: items,
  ...(nextCursor !== undefined && { meta: { nextCursor } }),
});
