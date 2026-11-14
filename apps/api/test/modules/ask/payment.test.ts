import { describe, expect, it, vi } from 'vitest';
import { decodeHeader, paymentResponseSchema } from '@askpay/shared/x402';
import { insufficientBalanceDetailsSchema } from '@askpay/shared/api';
import {
  DEPOSIT_TX,
  PRICE,
  QUESTION,
  createFakeChain,
  createTestApp,
  pay,
  payer,
  requestQuote,
  requirementOf,
  signPayment,
  stageOf,
  stranger,
} from '../../harness.js';

async function quoted(test = createTestApp()) {
  const quote = await requestQuote(test);
  return { test, quote, qid: requirementOf(quote).extra.qid };
}

describe('AP-03-AC01 a valid signature deposits the exact quoted amount', () => {
  it('sends one deposit with the signed values and answers 202 ANSWERING', async () => {
    const { test, quote, qid } = await quoted();
    const response = await pay(test, quote, await signPayment(quote));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ data: { qid, stage: 'ANSWERING' } });
    expect(test.chain.deposit).toHaveBeenCalledTimes(1);
    const [[call] = []] = test.chain.deposit.mock.calls;
    if (!call) throw new Error('deposit was not called');
    expect(call).toMatchObject({
      qid,
      // The wallet sent a checksummed address; the service works in lowercase.
      payer: payer.address.toLowerCase(),
      value: PRICE,
      validAfter: 0n,
      validBefore: BigInt(requirementOf(quote).extra.validBefore),
    });
    expect(call.signature).toMatch(/^0x[0-9a-f]{130}$/);

    const header = decodeHeader(paymentResponseSchema, response.headers['payment-response']);
    expect(header).toMatchObject({ success: true, transaction: DEPOSIT_TX });
    expect(stageOf(test, qid)).toBe('ANSWERING');
    const row = test.store
      .prepare('SELECT payer, deposit_tx FROM questions WHERE qid = ?')
      .get(qid);
    expect(row).toMatchObject({ payer: payer.address.toLowerCase(), deposit_tx: DEPOSIT_TX });
  });
});

describe('AP-03-AC02 bad authorisations are refused and never reach the chain', () => {
  const validBeforeOf = (quote: Awaited<ReturnType<typeof quoted>>['quote']) =>
    BigInt(requirementOf(quote).extra.validBefore);

  const cases: [string, (q: Awaited<ReturnType<typeof quoted>>['quote']) => Promise<string>][] = [
    ['signed by someone else', (q) => signPayment(q, { signer: stranger })],
    ['wrong amount in the authorisation', (q) => signPayment(q, { value: PRICE - 1n })],
    ['wrong recipient', (q) => signPayment(q, { to: stranger.address })],
    ['nonce bound to another qid', (q) => signPayment(q, { nonce: `0x${'ee'.repeat(32)}` })],
    ['window longer than the quote', (q) => signPayment(q, { validBefore: validBeforeOf(q) + 1n })],
    ['validAfter in the future', (q) => signPayment(q, { validAfter: validBeforeOf(q) })],
    ['accepted.amount differs from the quote', (q) => signPayment(q, { acceptedAmount: '1' })],
  ];

  it.each(cases)('%s -> 402 PAYMENT_INVALID, no deposit', async (_name, build) => {
    const { test, quote, qid } = await quoted();
    const response = await pay(test, quote, await build(quote));

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('PAYMENT_INVALID');
    expect(test.chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('refuses when under 60 seconds of validity remain', async () => {
    const { test, quote, qid } = await quoted();
    // The quote lives 300 s; move the clock to 30 s before it ends.
    test.clock.now += 270_000;
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(402);
    expect(response.body.error.details).toEqual({ reason: 'EXPIRED' });
    expect(test.chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('a missing, garbled or wrong-shape header is 402, not 500', async () => {
    const { test, quote } = await quoted();
    for (const header of ['%%%', 'e30=', Buffer.from('{"x402Version":1}').toString('base64')]) {
      const response = await pay(test, quote, header);
      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe('PAYMENT_INVALID');
    }
    expect(test.chain.deposit).not.toHaveBeenCalled();
  });

  it('an unknown qid is 404 and an expired quote is 404', async () => {
    const { test, quote, qid } = await quoted();
    const header = await signPayment(quote);

    const unknown = await test.api
      .post('/api/ask')
      .set('PAYMENT-SIGNATURE', header)
      .send({ question: QUESTION, qid: `0x${'00'.repeat(32)}` });
    expect(unknown.status).toBe(404);

    test.clock.now += 301_000;
    const expired = await pay(test, quote, header);
    expect(expired.status).toBe(404);
    expect(expired.body.error.code).toBe('QUESTION_NOT_FOUND');
    expect(stageOf(test, qid)).toBe('EXPIRED');
    expect(test.chain.deposit).not.toHaveBeenCalled();
  });

  it('a payment without a qid is a validation error', async () => {
    const { test, quote } = await quoted();
    const response = await test.api
      .post('/api/ask')
      .set('PAYMENT-SIGNATURE', await signPayment(quote))
      .send({ question: QUESTION });
    expect(response.status).toBe(400);
  });
});

describe('AP-03-AC03 replaying a signature never charges twice', () => {
  it('the second identical request is 409 and sends nothing', async () => {
    const { test, quote, qid } = await quoted();
    const header = await signPayment(quote);
    expect((await pay(test, quote, header)).status).toBe(202);

    const replay = await pay(test, quote, header);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('QUESTION_ALREADY_SETTLED');
    // details tell the caller where the question stands (api.md §3.3).
    expect(replay.body.error.details).toMatchObject({ qid, stage: 'ANSWERING', status: 'PENDING' });
    expect(test.chain.deposit).toHaveBeenCalledTimes(1);
  });

  it('two simultaneous identical requests send exactly one deposit', async () => {
    // Hold both requests inside the balance check, after each has seen the question as QUOTED, so
    // only the atomic stage claim can decide which one may send a deposit.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const payerBalance = vi.fn(async () => {
      await gate;
      return 10n * PRICE;
    });
    const chain = createFakeChain({ payerBalance });
    const { test, quote } = await quoted(createTestApp({ chain }));
    const header = await signPayment(quote);

    const first = pay(test, quote, header).then((r) => r);
    const second = pay(test, quote, header).then((r) => r);
    await vi.waitFor(() => expect(payerBalance).toHaveBeenCalledTimes(2));
    release();
    const statuses = (await Promise.all([first, second])).map((r) => r.status).sort();

    expect(statuses).toEqual([202, 409]);
    expect(chain.deposit).toHaveBeenCalledTimes(1);
  });
});

describe('AP-03-AC04 the paid question must be the quoted one', () => {
  it('a different question for the same qid is 409 QUESTION_MISMATCH', async () => {
    const { test, quote, qid } = await quoted();
    const response = await pay(test, quote, await signPayment(quote), 'Một câu hỏi hoàn toàn khác');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('QUESTION_MISMATCH');
    expect(test.chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('the same text in decomposed Unicode still matches (NFC)', async () => {
    const { test, quote } = await quoted();
    const response = await pay(test, quote, await signPayment(quote), QUESTION.normalize('NFD'));
    expect(response.status).toBe(202);
  });
});

describe('AP-03-AC05 a payer who cannot afford it sees why, and nothing is sent', () => {
  it('returns balance, price and a faucet link', async () => {
    const chain = createFakeChain({ payerBalance: vi.fn(async () => 10_000n) });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('PAYMENT_INVALID');
    expect(insufficientBalanceDetailsSchema.parse(response.body.error.details)).toEqual({
      reason: 'INSUFFICIENT_BALANCE',
      balance: '10000',
      price: PRICE.toString(),
      faucetUrl: 'https://faucet.circle.com',
    });
    expect(chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });
});

describe('AP-03-AC06 an unknown deposit outcome is never reported as a failure', () => {
  it('answers 202 DEPOSITING, never 402, and a retry cannot pay again', async () => {
    const chain = createFakeChain({ deposit: vi.fn(async () => ({ kind: 'unknown' as const })) });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const header = await signPayment(quote);

    const first = await pay(test, quote, header);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ data: { qid, stage: 'DEPOSITING' } });
    expect(stageOf(test, qid)).toBe('DEPOSITING');

    const retry = await pay(test, quote, header);
    expect(retry.status).toBe(409);
    expect(chain.deposit).toHaveBeenCalledTimes(1);
  });

  it('a reverted deposit with money held (chain Open) counts as deposited', async () => {
    const chain = createFakeChain({
      deposit: vi.fn(async () => ({ kind: 'mined' as const, hash: DEPOSIT_TX, success: false })),
      questionStatus: vi.fn(async () => 'Open' as const),
    });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(202);
    expect(response.body.data.stage).toBe('ANSWERING');
    expect(stageOf(test, qid)).toBe('ANSWERING');
    // The reverted tx is not the deposit: it must not be stored or announced as one.
    const row = test.store.prepare('SELECT deposit_tx FROM questions WHERE qid = ?').get(qid);
    expect(row).toMatchObject({ deposit_tx: null });
    const header = decodeHeader(paymentResponseSchema, response.headers['payment-response']);
    expect(header?.transaction).toBeUndefined();
  });

  it('a reverted deposit with nothing held (chain None) returns to QUOTED and is 402', async () => {
    const chain = createFakeChain({
      deposit: vi.fn(async () => ({ kind: 'mined' as const, hash: DEPOSIT_TX, success: false })),
      questionStatus: vi.fn(async () => 'None' as const),
    });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(402);
    expect(response.body.error.details).toEqual({ reason: 'DEPOSIT_FAILED' });
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('a failed deposit whose chain status cannot be read stays DEPOSITING', async () => {
    const chain = createFakeChain({
      deposit: vi.fn(async () => ({ kind: 'not-sent' as const, reason: 'rpc down' })),
      questionStatus: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(202);
    expect(response.body.data.stage).toBe('DEPOSITING');
    expect(stageOf(test, qid)).toBe('DEPOSITING');
  });
});

describe('AP-03-AC07 the provider wallet must afford the deposit and a settle', () => {
  it('refuses with 503 before holding any money', async () => {
    const chain = createFakeChain({ providerCanPayGas: vi.fn(async () => false) });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CHAIN_UNAVAILABLE');
    expect(chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('an unreadable RPC before the deposit is also 503 and charges nothing', async () => {
    const chain = createFakeChain({
      payerBalance: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    });
    const { test, quote, qid } = await quoted(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(503);
    expect(chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });
});
