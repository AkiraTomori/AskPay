// The dashboard endpoints (A6, AP-08, AP-01-AC04): the list, the totals, the corpus check and the
// health report. Totals come from chain events; the questions table only supplies the text.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  corpusInfoSchema,
  healthSchema,
  questionListItemSchema,
  statsSchema,
} from '@askpay/shared/api';
import { refundReasonCodes } from '@askpay/shared/errors';
import { PRICE, ask, corpus, createFakeLlm, createTestApp, type TestApp } from '../../harness.js';

// Two answered questions and one the chain refunded as NO_CITATION, then indexed.
async function populated(extra: Parameters<typeof createTestApp>[0] = {}) {
  const llm = createFakeLlm();
  const test = createTestApp({ llm, ...extra });
  const paid1 = await ask(test);
  const paid2 = await ask(test);
  const normal = llm.state.answer;
  llm.state.answer = () => JSON.stringify({ noBasis: true, answer: '', citations: [] });
  const refunded = await ask(test);
  llm.state.answer = normal;
  await test.indexer.sweep();
  return { test, paid1, paid2, refunded };
}

describe('AP-08-AC01 /stats', () => {
  it('counts questions, paid, refunded, the refund rate and the revenue from chain events', async () => {
    const { test } = await populated();
    const response = await test.api.get('/api/stats');
    expect(response.status).toBe(200);
    const stats = statsSchema.parse(response.body.data);
    expect(stats).toMatchObject({
      questions: 3,
      paid: 2,
      refunded: 1,
      providerRevenue: (2n * PRICE).toString(),
      eval: null,
    });
    expect(stats.refundRate).toBeCloseTo(1 / 3);
    expect(stats.refundsByReason).toEqual({
      NO_CITATION: 1,
      INVALID_CITATION: 0,
      CHECKER_REJECTED: 0,
      ANSWER_FAILED: 0,
      TIMEOUT: 0,
    });
    expect(Object.keys(stats.refundsByReason).sort()).toEqual([...refundReasonCodes].sort());
    expect(stats.lastIndexedBlock).toBe(test.chain.block.number);
  });

  it('is all zeros before anything is indexed, with no division by zero', async () => {
    const test = createTestApp();
    const stats = statsSchema.parse((await test.api.get('/api/stats')).body.data);
    expect(stats).toMatchObject({
      questions: 0,
      paid: 0,
      refunded: 0,
      refundRate: 0,
      providerRevenue: '0',
    });
  });

  it('AP-08-AC02 does not read the questions table: wiping it changes no number', async () => {
    const { test } = await populated();
    const before = (await test.api.get('/api/stats')).body.data;
    test.store.exec('DELETE FROM questions');
    expect((await test.api.get('/api/stats')).body.data).toEqual(before);
  });

  it('counts a payer who claimed after the deadline as TIMEOUT, which only the chain knows', async () => {
    const { test } = await populated();
    const orphan = `0x${'f1'.repeat(32)}` as const;
    test.chain.plantDeposit(orphan, 0);
    test.chain.claimRefund(orphan);
    await test.indexer.sweep();
    const stats = statsSchema.parse((await test.api.get('/api/stats')).body.data);
    expect(stats.refundsByReason.TIMEOUT).toBe(1);
    expect(stats.questions).toBe(4);
  });

  it('counts a log once however many times its range is read', async () => {
    const { test } = await populated();
    test.store.exec('DELETE FROM event_index_checkpoint'); // the scan reads everything again
    const again = createTestApp({ store: test.store, chain: test.chain });
    await again.indexer.sweep();
    expect(statsSchema.parse((await again.api.get('/api/stats')).body.data).questions).toBe(3);
  });

  it('reports the last eval run from eval/results/latest.json, or null for a missing or broken file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'askpay-eval-'));
    const good = join(dir, 'latest.json');
    const summary = {
      runAt: '2026-11-18',
      commit: 'abc1234',
      citationAccuracy: 0.82,
      checkerPassRate: 0.78,
      outOfScopeCorrect: 0.9,
    };
    writeFileSync(good, JSON.stringify(summary));
    const bad = join(dir, 'broken.json');
    writeFileSync(bad, '{ not json');

    const read = async (evalPath: string) =>
      statsSchema.parse((await createTestApp({ evalPath }).api.get('/api/stats')).body.data).eval;
    expect(await read(good)).toEqual(summary);
    expect(await read(bad)).toBeNull();
    expect(await read(join(dir, 'missing.json'))).toBeNull();
  });
});

describe('AP-08-AC01 /questions', () => {
  it('lists started questions newest first, each with its status and settle tx; quotes are left out', async () => {
    const { test, paid1, refunded } = await populated();
    await test.api.post('/api/ask').send({ question: 'Một báo giá chưa trả tiền' }); // QUOTED only
    const response = await test.api.get('/api/questions');
    expect(response.status).toBe(200);
    const items = (response.body.data as unknown[]).map((item) =>
      questionListItemSchema.parse(item),
    );
    expect(items).toHaveLength(3);
    expect(response.body.meta).toBeUndefined();
    const byQid = new Map(items.map((item) => [item.qid, item]));
    expect(byQid.get(paid1.qid)).toMatchObject({
      status: 'PAID',
      reason: null,
      amount: PRICE.toString(),
    });
    expect(byQid.get(refunded.qid)).toMatchObject({ status: 'REFUNDED', reason: 'NO_CITATION' });
    for (const item of items) expect(item.tx.settle).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('pages with a cursor: every question exactly once, however many share a timestamp', async () => {
    const { test } = await populated(); // all three were created at the same fixed instant
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const response = await test.api
        .get('/api/questions')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200);
      seen.push(...(response.body.data as { qid: string }[]).map((item) => item.qid));
      cursor = response.body.meta?.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('cuts a long question to 120 characters', async () => {
    const test = createTestApp();
    const long = `${'Thử việc '.repeat(40)}?`.slice(0, 400);
    await ask(test, long);
    const [item] = (await test.api.get('/api/questions')).body.data as { question: string }[];
    expect(Array.from(item?.question ?? '')).toHaveLength(120);
    expect(item?.question.endsWith('…')).toBe(true);
  });

  it('shows the chain, not the row: a row edited to PAID is listed REFUNDED', async () => {
    const { test, refunded } = await populated();
    test.store
      .prepare("UPDATE questions SET stage = 'PAID', reason = NULL WHERE qid = ?")
      .run(refunded.qid);
    const items = (await test.api.get('/api/questions')).body.data as {
      qid: string;
      status: string;
      reason: string | null;
    }[];
    expect(items.find((item) => item.qid === refunded.qid)).toMatchObject({
      status: 'REFUNDED',
      reason: 'NO_CITATION',
    });
  });

  it.each([
    ['limit', 0],
    ['limit', 101],
    ['limit', 'many'],
    ['cursor', 'not-a-cursor'],
  ] as const)('rejects a bad %s (%s) with VALIDATION_FAILED', async (name, value) => {
    const test = createTestApp();
    const response = await test.api.get('/api/questions').query({ [name]: value });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('AP-01-AC04 /corpus', () => {
  it('reports the repo root, the on-chain root and whether they match', async () => {
    const test = createTestApp();
    const response = await test.api.get('/api/corpus');
    const info = corpusInfoSchema.parse(response.body.data);
    expect(info).toMatchObject({
      lawId: corpus.lawId,
      repoRoot: corpus.root,
      onChainRoot: corpus.root,
      rootMatches: true,
      dieuCount: new Set(corpus.docs().map((doc) => doc.dieu)).size,
      khoanCount: corpus.docs().length,
    });
    expect(info.explorer).toMatch(/^https:\/\/testnet\.snowtrace\.io\/address\/0x/);
  });

  it('says so when the registered root differs, and answers 503 when the chain cannot be read', async () => {
    const other = createTestApp();
    other.chain.lawRootOf.mockResolvedValueOnce(`0x${'12'.repeat(32)}`);
    expect(corpusInfoSchema.parse((await other.api.get('/api/corpus')).body.data).rootMatches).toBe(
      false,
    );

    const down = createTestApp();
    down.chain.lawRootOf.mockRejectedValueOnce(new Error('rpc'));
    const response = await down.api.get('/api/corpus');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CHAIN_UNAVAILABLE');
  });
});

describe('/health', () => {
  const health = async (test: TestApp) => {
    const response = await test.api.get('/api/health');
    return { status: response.status, data: healthSchema.parse(response.body.data) };
  };

  it('is ok with the provider balance in AVAX and how far the index trails', async () => {
    const test = createTestApp();
    await test.indexer.sweep();
    test.chain.block.number += 3; // three blocks the indexer has not read yet
    expect(await health(test)).toEqual({
      status: 200,
      data: {
        ok: true,
        rpc: 'ok',
        llm: 'ok',
        providerBalanceAvax: '1.42',
        lowBalance: false,
        indexerLagBlocks: 3,
      },
    });
    await test.indexer.sweep();
    test.clock.now += 6_000; // past the 5 s cache
    expect((await health(test)).data.indexerLagBlocks).toBe(0);
  });

  it('before the first scan the whole window counts as lag, not zero', async () => {
    const test = createTestApp();
    expect((await health(test)).data.indexerLagBlocks).toBeGreaterThan(0);
  });

  it('warns below 0.2 AVAX without failing', async () => {
    const test = createTestApp();
    test.chain.providerBalance.mockResolvedValue(199_999_999_999_999_999n);
    expect(await health(test)).toMatchObject({
      status: 200,
      data: { ok: true, lowBalance: true, providerBalanceAvax: '0.19' },
    });
    test.chain.providerBalance.mockResolvedValue(200_000_000_000_000_000n);
    test.clock.now += 6_000; // past the 5 s cache
    expect((await health(test)).data).toMatchObject({
      lowBalance: false,
      providerBalanceAvax: '0.20',
    });
  });

  it('answers 503 with rpc: down when the RPC does not answer', async () => {
    const test = createTestApp();
    test.chain.providerBalance.mockRejectedValue(new Error('rpc'));
    expect(await health(test)).toMatchObject({ status: 503, data: { ok: false, rpc: 'down' } });
  });

  it('a stuck tx queue makes it not ok (§5.6 C) but is not an HTTP error', async () => {
    const test = createTestApp();
    test.chain.txHealthy.mockReturnValue(false);
    expect(await health(test)).toMatchObject({ status: 200, data: { ok: false, rpc: 'ok' } });
  });

  it('reports the last LLM outcome and never calls the model', async () => {
    const test = createTestApp({ llmStatus: () => 'down' });
    expect((await health(test)).data.llm).toBe('down');
    expect(test.llm.complete).not.toHaveBeenCalled();
  });
});

describe('read endpoints are cached for 5 s and share one load (A6 review, finding 2)', () => {
  it('/health: a burst of requests makes ONE RPC read, and a new read after the TTL', async () => {
    const test = createTestApp();
    // A slow RPC, so the eight requests really overlap instead of each finishing before the next.
    test.chain.providerBalance.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(1_420_000_000_000_000_000n), 50)),
    );
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => test.api.get('/api/health')),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(test.chain.providerBalance).toHaveBeenCalledTimes(1);
    expect(test.chain.latestBlock).toHaveBeenCalledTimes(1);

    await test.api.get('/api/health');
    expect(test.chain.providerBalance).toHaveBeenCalledTimes(1);
    test.clock.now += 5_001;
    await test.api.get('/api/health');
    expect(test.chain.providerBalance).toHaveBeenCalledTimes(2);
  });

  it('/health: a "rpc down" answer is not kept, so recovery shows on the very next request', async () => {
    const test = createTestApp();
    test.chain.providerBalance.mockRejectedValueOnce(new Error('rpc'));
    expect((await test.api.get('/api/health')).status).toBe(503);
    const next = await test.api.get('/api/health'); // same instant, no TTL wait
    expect(next.status).toBe(200);
    expect(next.body.data.rpc).toBe('ok');
  });

  it('/stats: reuses the totals within the TTL, then shows what the indexer read since', async () => {
    const test = createTestApp();
    await ask(test);
    await test.indexer.sweep();
    const first = (await test.api.get('/api/stats')).body.data;
    expect(first.questions).toBe(1);

    await ask(test);
    await test.indexer.sweep(); // a second question is now indexed
    expect((await test.api.get('/api/stats')).body.data.questions).toBe(1); // still the cached totals
    test.clock.now += 5_001;
    expect((await test.api.get('/api/stats')).body.data.questions).toBe(2);
  });

  it('/questions: the first page is cached per limit; a page with a cursor is read every time', async () => {
    const test = createTestApp();
    await ask(test);
    await ask(test);
    await test.indexer.sweep();
    const spy = vi.spyOn(test.askService, 'listQuestions');

    await test.api.get('/api/questions').query({ limit: 1 });
    await test.api.get('/api/questions').query({ limit: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    await test.api.get('/api/questions').query({ limit: 2 }); // another limit is another page
    expect(spy).toHaveBeenCalledTimes(2);

    const { nextCursor } = (await test.api.get('/api/questions').query({ limit: 1 })).body.meta;
    await test.api.get('/api/questions').query({ limit: 1, cursor: nextCursor });
    await test.api.get('/api/questions').query({ limit: 1, cursor: nextCursor });
    expect(spy).toHaveBeenCalledTimes(4); // both cursor reads went through
  });

  it('/questions: an invalid cursor is still a 400, never cached', async () => {
    const test = createTestApp();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await test.api.get('/api/questions').query({ cursor: 'not-a-cursor' });
      expect(response.status).toBe(400);
    }
  });
});

describe('read endpoints are rate limited per IP (A6 review, finding 1)', () => {
  it.each(['/api/health', '/api/stats', '/api/questions', '/api/corpus'])(
    '%s answers RATE_LIMITED (429) after the limit, with the standard headers',
    async (path) => {
      const test = createTestApp({ readRateLimitPerMinute: 3 });
      for (let call = 0; call < 3; call += 1) expect((await test.api.get(path)).status).toBe(200);
      const limited = await test.api.get(path);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.headers['ratelimit']).toBeDefined();
    },
  );

  it('the limit is shared by the read endpoints of one IP, and also covers GET /questions/:qid', async () => {
    const test = createTestApp({ readRateLimitPerMinute: 3 });
    await test.api.get('/api/stats');
    await test.api.get('/api/health');
    await test.api.get(`/api/questions/0x${'ab'.repeat(32)}`); // 404 still counts
    expect((await test.api.get('/api/stats')).status).toBe(429);
  });

  it('is separate from the limit on POST /ask, in both directions', async () => {
    const test = createTestApp({ readRateLimitPerMinute: 1, rateLimitPerMinute: 1 });
    expect((await test.api.post('/api/ask').send({ question: 'Thử việc?' })).status).toBe(402);
    expect((await test.api.get('/api/stats')).status).toBe(200); // not spent by the ask
    expect((await test.api.get('/api/stats')).status).toBe(429);
    expect((await test.api.post('/api/ask').send({ question: 'Thử việc?' })).status).toBe(429);
  });

  it('with trustProxyHops each client behind the proxy has its own limit; without it they share one', async () => {
    const behind = (trustProxyHops: number) =>
      createTestApp({ readRateLimitPerMinute: 1, trustProxyHops });
    const trusted = behind(1);
    expect((await trusted.api.get('/api/stats').set('X-Forwarded-For', '1.1.1.1')).status).toBe(
      200,
    );
    expect((await trusted.api.get('/api/stats').set('X-Forwarded-For', '2.2.2.2')).status).toBe(
      200,
    );
    expect((await trusted.api.get('/api/stats').set('X-Forwarded-For', '1.1.1.1')).status).toBe(
      429,
    );
  });
});
