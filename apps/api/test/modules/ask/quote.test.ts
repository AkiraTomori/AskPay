import { describe, expect, it } from 'vitest';
import { decodeHeader, paymentRequiredSchema } from '@askpay/shared/x402';
import {
  requirementOf,
  ESCROW,
  PRICE,
  QUESTION,
  TOKEN,
  createTestApp,
  rowCount,
  stageOf,
} from '../../harness.js';

describe('AP-02-AC01 first request returns a 402 quote', () => {
  it('answers 402 with price, token, escrow, qid and deadline, and touches no money', async () => {
    const test = createTestApp();
    const response = await test.api.post('/api/ask').send({ question: QUESTION });

    expect(response.status).toBe(402);
    const body = paymentRequiredSchema.parse(response.body);
    const requirement = requirementOf(body);
    expect(requirement.scheme).toBe('escrow');
    expect(requirement.network).toBe('eip155:43113');
    expect(requirement.amount).toBe(PRICE.toString());
    // api.md §1: addresses in the API are lowercase.
    expect(requirement.asset).toBe(TOKEN.toLowerCase());
    expect(requirement.payTo).toBe(ESCROW.toLowerCase());
    expect(requirement.extra.qid).toMatch(/^0x[0-9a-f]{64}$/);
    expect(requirement.extra.tokenName).toBe('USD Coin');
    expect(requirement.extra.tokenVersion).toBe('2');
    expect(requirement.extra.answerWindowSeconds).toBe(600);
    expect(requirement.extra.validBefore).toBe(
      String(Math.floor((test.clock.now + 300_000) / 1000)),
    );

    // The header carries the same JSON as the body (api.md §3.1).
    expect(decodeHeader(paymentRequiredSchema, response.headers['payment-required'])).toEqual(body);

    expect(stageOf(test, requirement.extra.qid)).toBe('QUOTED');
    expect(test.chain.deposit).not.toHaveBeenCalled();
    expect(test.chain.payerBalance).not.toHaveBeenCalled();
  });

  it('gives every quote its own qid, even for the same question', async () => {
    const test = createTestApp();
    const first = await test.api.post('/api/ask').send({ question: QUESTION });
    const second = await test.api.post('/api/ask').send({ question: QUESTION });
    expect(first.body.accepts[0].extra.qid).not.toBe(second.body.accepts[0].extra.qid);
  });
});

describe('AP-02-AC02 invalid questions are refused without a quote', () => {
  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['501 characters', 'a'.repeat(501)],
  ])('%s -> 400 VALIDATION_FAILED and no row', async (_name, question) => {
    const test = createTestApp();
    const response = await test.api.post('/api/ask').send({ question });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(rowCount(test)).toBe(0);
  });

  it('accepts exactly 500 characters', async () => {
    const test = createTestApp();
    const response = await test.api.post('/api/ask').send({ question: 'a'.repeat(500) });
    expect(response.status).toBe(402);
  });

  it('a missing body and malformed JSON are 400, not 500', async () => {
    const test = createTestApp();
    expect((await test.api.post('/api/ask').send({})).status).toBe(400);
    const broken = await test.api
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send('{"question": ');
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('VALIDATION_FAILED');
    expect(rowCount(test)).toBe(0);
  });

  it('counts the limit after NFC normalisation and trimming', async () => {
    const test = createTestApp();
    // 500 decomposed "é" is 1000 code points but 500 after NFC: allowed.
    const decomposed = 'é'.repeat(500);
    const response = await test.api.post('/api/ask').send({ question: decomposed });
    expect(response.status).toBe(402);
  });
});

describe('rate limit (api.md §1)', () => {
  it('answers 429 RATE_LIMITED past the per-minute limit', async () => {
    const test = createTestApp({ rateLimitPerMinute: 2 });
    await test.api.post('/api/ask').send({ question: QUESTION });
    await test.api.post('/api/ask').send({ question: QUESTION });
    const third = await test.api.post('/api/ask').send({ question: QUESTION });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
