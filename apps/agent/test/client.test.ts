import { fujiDeployment } from '@askpay/shared/abi';
import {
  decodeHeader,
  paymentPayloadSchema,
  receiveAuthorizationTypedData,
} from '@askpay/shared/x402';
import { verifyTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import { createBudget } from '../src/budget.js';
import { askAndPay } from '../src/client.js';
import {
  NETWORK_ERROR,
  PRICE,
  account,
  apiError,
  clientDeps,
  countingSigner,
  fakeApi,
  happyHandler,
  qidOf,
  quote,
  result,
  type Handler,
} from './harness.js';

const Q = 'Thời gian thử việc tối đa là bao lâu?';

describe('AP-10-AC01 · ask, sign, pay, read the result', () => {
  it('AP-10-AC01: 402 -> sign -> 200 PAID for two questions in a row', async () => {
    const api = fakeApi(happyHandler());
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer });

    const first = await askAndPay(Q, deps);
    const second = await askAndPay('Nghỉ phép năm là bao nhiêu ngày?', deps);

    for (const outcome of [first, second]) {
      expect(outcome.kind).toBe('settled');
      if (outcome.kind === 'settled') {
        expect(outcome.result.status).toBe('PAID');
        expect(outcome.result.citations?.[0]?.dieu).toBe(25);
      }
    }
    expect(calls).toHaveLength(2);
    expect(deps.budget.committed()).toBe(PRICE * 2n);
  });

  it('AP-10-AC01: the payment carries a valid EIP-3009 signature for exactly what the quote asked', async () => {
    const api = fakeApi(happyHandler());
    await askAndPay(Q, clientDeps(api));

    const pay = api.payCalls()[0];
    const payload = decodeHeader(paymentPayloadSchema, pay?.paymentSignature);
    expect(payload).toBeDefined();
    const authorization = payload?.payload.authorization;
    expect(authorization).toMatchObject({
      from: account.address.toLowerCase(),
      to: fujiDeployment.address,
      value: PRICE.toString(),
      validAfter: '0',
      nonce: qidOf(1),
    });
    const valid = await verifyTypedData({
      address: account.address,
      signature: payload?.payload.signature as `0x${string}`,
      ...receiveAuthorizationTypedData({
        tokenName: 'USD Coin',
        tokenVersion: '2',
        asset: fujiDeployment.token.toLowerCase() as `0x${string}`,
        authorization: {
          from: account.address,
          to: fujiDeployment.address,
          value: PRICE,
          validAfter: 0n,
          validBefore: BigInt(authorization?.validBefore ?? '0'),
          nonce: qidOf(1) as `0x${string}`,
        },
      }),
    });
    expect(valid).toBe(true);
    expect(pay?.body).toEqual({ question: Q, qid: qidOf(1) });
  });

  it('AP-10-AC01: sends the NFC-normalised, trimmed question in the quote and the payment', async () => {
    const api = fakeApi(happyHandler());
    const decomposed = `  ${Q.normalize('NFD')}  `;
    await askAndPay(decomposed, clientDeps(api));
    expect(api.quoteCalls()[0]?.body?.question).toBe(Q);
    expect(api.payCalls()[0]?.body?.question).toBe(Q);
  });

  it('AP-10-AC01: 202 then polling reaches REFUNDED, and a refund is a result, not an error', async () => {
    let polls = 0;
    const handler: Handler = (call, state) => {
      if (call.method === 'GET') {
        polls++;
        return polls < 3
          ? { status: 200, json: result(qidOf(1), { status: undefined, stage: 'ANSWERING' }) }
          : {
              status: 200,
              json: result(qidOf(1), {
                status: 'REFUNDED',
                stage: 'REFUNDED',
                reason: 'NO_CITATION',
              }),
            };
      }
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return { status: 202, json: { data: { qid: qidOf(1), stage: 'DEPOSITING' } } };
    };
    const api = fakeApi(handler);
    const outcome = await askAndPay(Q, clientDeps(api));

    expect(polls).toBe(3);
    expect(outcome.kind).toBe('settled');
    if (outcome.kind === 'settled') expect(outcome.result.reason).toBe('NO_CITATION');
    expect(api.payCalls()).toHaveLength(1);
  });

  it('AP-10-AC01: a network error after the payment polls by qid and never asks for a second quote', async () => {
    const handler: Handler = (call, state) => {
      if (call.method === 'GET') return { status: 200, json: result(qidOf(1)) };
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return NETWORK_ERROR;
    };
    const api = fakeApi(handler);
    const deps = clientDeps(api);
    const outcome = await askAndPay(Q, deps);

    expect(api.quoteCalls()).toHaveLength(1);
    expect(api.payCalls()).toHaveLength(1);
    expect(
      api.calls.some((c) => c.method === 'GET' && c.path === `/api/questions/${qidOf(1)}`),
    ).toBe(true);
    expect(outcome.kind).toBe('settled');
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('AP-10-AC01: 409 QUESTION_ALREADY_SETTLED uses its details as the result', async () => {
    const handler: Handler = (call, state) => {
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return apiError(409, 'QUESTION_ALREADY_SETTLED', result(qidOf(1)).data);
    };
    const outcome = await askAndPay(Q, clientDeps(fakeApi(handler)));
    expect(outcome.kind).toBe('settled');
  });

  it('AP-10-AC01: a 200 that cannot be read falls back to polling and keeps the commitment', async () => {
    const handler: Handler = (call, state) => {
      if (call.method === 'GET') return { status: 200, json: result(qidOf(1)) };
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return { status: 200, json: { unexpected: true } };
    };
    const deps = clientDeps(fakeApi(handler));
    expect((await askAndPay(Q, deps)).kind).toBe('settled');
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('never signs a second time when the answer does not arrive: the result is unresolved', async () => {
    const handler: Handler = (call, state) => {
      if (call.method === 'GET') {
        return { status: 200, json: result(qidOf(1), { status: undefined, stage: 'ANSWERING' }) };
      }
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return { status: 202, json: { data: { qid: qidOf(1), stage: 'DEPOSITING' } } };
    };
    const api = fakeApi(handler);
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer, pollTimeoutMs: 20_000, pollIntervalMs: 2_000 });
    const outcome = await askAndPay(Q, deps);

    expect(outcome.kind).toBe('unresolved');
    expect(calls).toHaveLength(1);
    expect(api.quoteCalls()).toHaveLength(1);
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('a CLAIMABLE question is reported as unresolved right away', async () => {
    const handler: Handler = (call, state) => {
      if (call.method === 'GET') {
        return { status: 200, json: result(qidOf(1), { status: 'CLAIMABLE', stage: 'ANSWERING' }) };
      }
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      return { status: 202, json: { data: { qid: qidOf(1), stage: 'ANSWERING' } } };
    };
    const outcome = await askAndPay(Q, clientDeps(fakeApi(handler)));
    expect(outcome.kind).toBe('unresolved');
  });

  it('an invalid question is skipped before any request', async () => {
    const api = fakeApi(happyHandler());
    for (const bad of ['', '   ', 'x'.repeat(501)]) {
      expect((await askAndPay(bad, clientDeps(api))).kind).toBe('skipped');
    }
    expect(api.calls).toHaveLength(0);
  });
});

describe('AP-10-AC02 · the budget cap', () => {
  it('AP-10-AC02: a cap of two prices signs two questions and the third is not signed', async () => {
    const api = fakeApi(happyHandler());
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer, cap: PRICE * 2n });

    const outcomes = [];
    for (const question of ['q1', 'q2', 'q3']) outcomes.push(await askAndPay(question, deps));

    expect(outcomes.map((o) => o.kind)).toEqual(['settled', 'settled', 'stopped']);
    const third = outcomes[2];
    expect(third?.kind === 'stopped' && third.reason).toBe('BUDGET');
    expect(third?.kind === 'stopped' && third.price).toBe(PRICE);
    expect(calls).toHaveLength(2);
    expect(api.payCalls()).toHaveLength(2);
    expect(deps.budget.committed()).toBe(PRICE * 2n);
  });

  it('AP-10-AC02: a cap exactly equal to the price still signs that question', async () => {
    const { signer, calls } = countingSigner();
    const outcome = await askAndPay(Q, clientDeps(fakeApi(happyHandler()), { signer, cap: PRICE }));
    expect(outcome.kind).toBe('settled');
    expect(calls).toHaveLength(1);
  });

  it('AP-10-AC02: a cap below one price signs nothing and sends no payment', async () => {
    const api = fakeApi(happyHandler());
    const { signer, calls } = countingSigner();
    const outcome = await askAndPay(Q, clientDeps(api, { signer, cap: PRICE - 1n }));
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('BUDGET');
    expect(calls).toHaveLength(0);
    expect(api.payCalls()).toHaveLength(0);
  });
});

describe('guard · a bad quote is never signed', () => {
  const stranger = `0x${'ab'.repeat(20)}`;
  const extra = quote().accepts[0]?.extra;
  it.each([
    ['payTo', { payTo: stranger }],
    ['asset', { asset: stranger }],
    ['network', { network: 'eip155:1' }],
    ['validBefore too far', { extra: { ...extra, validBefore: '9999999999' } }],
    ['validBefore passed', { extra: { ...extra, validBefore: '1' } }],
  ])('refuses a quote with a wrong %s: no signature, no commitment', async (_name, overrides) => {
    const handler: Handler = (call, state) =>
      call.paymentSignature
        ? { status: 500 }
        : { status: 402, json: quote(overrides, state.quotes) };
    const api = fakeApi(handler);
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer });
    const outcome = await askAndPay(Q, deps);

    // A schema failure (wrong network) and a guard failure both stop the run before the key is used.
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('GUARD');
    expect(calls).toHaveLength(0);
    expect(api.payCalls()).toHaveLength(0);
    expect(deps.budget.committed()).toBe(0n);
  });

  it('refuses a 402 that is not a quote', async () => {
    const api = fakeApi(() => ({ status: 402, json: { hello: 'world' } }));
    const { signer, calls } = countingSigner();
    const outcome = await askAndPay(Q, clientDeps(api, { signer }));
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('GUARD');
    expect(calls).toHaveLength(0);
  });
});

describe('giving the reservation back', () => {
  const payReply =
    (reply: ReturnType<typeof apiError>): Handler =>
    (call, state) =>
      call.paymentSignature ? reply : { status: 402, json: quote({}, state.quotes) };

  it('402 PAYMENT_INVALID returns the cap and skips the question', async () => {
    const deps = clientDeps(fakeApi(payReply(apiError(402, 'PAYMENT_INVALID'))));
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind).toBe('skipped');
    expect(deps.budget.committed()).toBe(0n);
  });

  it('402 INSUFFICIENT_BALANCE says what the wallet is short of', async () => {
    const details = {
      reason: 'INSUFFICIENT_BALANCE',
      balance: '10000',
      price: '50000',
      faucetUrl: 'https://faucet.test',
    };
    const outcome = await askAndPay(
      Q,
      clientDeps(fakeApi(payReply(apiError(402, 'PAYMENT_INVALID', details)))),
    );
    expect(outcome.kind === 'skipped' && outcome.message).toContain('0.01');
    expect(outcome.kind === 'skipped' && outcome.message).toContain('https://faucet.test');
  });

  it.each([
    ['400 VALIDATION_FAILED', apiError(400, 'VALIDATION_FAILED')],
    ['404 QUESTION_NOT_FOUND', apiError(404, 'QUESTION_NOT_FOUND')],
  ])('%s returns the cap and skips', async (_name, reply) => {
    const deps = clientDeps(fakeApi(payReply(reply)));
    expect((await askAndPay(Q, deps)).kind).toBe('skipped');
    expect(deps.budget.committed()).toBe(0n);
  });

  it('503 CHAIN_UNAVAILABLE returns the cap and stops the run', async () => {
    const deps = clientDeps(fakeApi(payReply(apiError(503, 'CHAIN_UNAVAILABLE'))));
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('CHAIN');
    expect(deps.budget.committed()).toBe(0n);
  });

  it('keeps the cap for a 200, a network error and an unlisted status', async () => {
    const unlisted = payReply({ status: 500, json: undefined });
    for (const handler of [happyHandler(), unlisted]) {
      const deps = clientDeps(fakeApi(handler), { pollTimeoutMs: 4_000 });
      await askAndPay(Q, deps);
      expect(deps.budget.committed()).toBe(PRICE);
    }
  });

  it('returns the cap when signing itself fails', async () => {
    const api = fakeApi(happyHandler());
    const budget = createBudget(PRICE);
    const signer = {
      address: account.address,
      signTypedData: () => Promise.reject(new Error('boom')),
    };
    const outcome = await askAndPay(Q, clientDeps(api, { signer, budget }));
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('ERROR');
    expect(budget.committed()).toBe(0n);
    expect(api.payCalls()).toHaveLength(0);
  });
});

describe('a rate limit on the payment request', () => {
  // Quotes always work. The first `limited` payment requests get `payReply`; every later payment
  // request and every poll goes to `then`.
  const limitedPay =
    (limited: number, payReply: ReturnType<typeof apiError>, then: Handler = happyHandler()) =>
    (): Handler => {
      let seen = 0;
      return (call, state) => {
        if (call.method === 'POST' && !call.paymentSignature) {
          return { status: 402, json: quote({}, state.quotes) };
        }
        if (call.paymentSignature && ++seen <= limited) return payReply;
        return then(call, state);
      };
    };

  it('AP-10-AC01: 429 RATE_LIMITED on the payment waits, resends the same signed request and settles', async () => {
    const api = fakeApi(limitedPay(2, apiError(429, 'RATE_LIMITED'))());
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer });
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind).toBe('settled');
    // One quote, one signature, three identical pay requests: the user is charged once.
    expect(api.quoteCalls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const pays = api.payCalls();
    expect(pays).toHaveLength(3);
    expect(new Set(pays.map((p) => p.paymentSignature)).size).toBe(1);
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('AP-10-AC02: when the 429 does not clear, the run stops, the cap is given back and nothing is signed twice', async () => {
    const api = fakeApi(limitedPay(99, apiError(429, 'RATE_LIMITED'))());
    const { signer, calls } = countingSigner();
    const deps = clientDeps(api, { signer });
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('RATE_LIMIT');
    expect(api.payCalls()).toHaveLength(4); // the first try and three retries
    expect(api.quoteCalls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(deps.budget.committed()).toBe(0n);
  });

  it('a 429 without the API error envelope is not trusted: the cap is kept and the question is polled', async () => {
    const api = fakeApi(limitedPay(1, { status: 429 }, () => ({ status: 404 }))());
    const deps = clientDeps(api, { pollTimeoutMs: 4_000 });
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind).toBe('unresolved');
    expect(api.payCalls()).toHaveLength(1); // not resent
    expect(api.calls.some((c) => c.method === 'GET')).toBe(true);
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('a network error after a 429 retry still polls by qid and never asks for a second quote', async () => {
    const api = fakeApi(limitedPay(1, apiError(429, 'RATE_LIMITED'), () => NETWORK_ERROR)());
    const deps = clientDeps(api, { pollTimeoutMs: 4_000 });
    await askAndPay(Q, deps);
    expect(api.quoteCalls()).toHaveLength(1);
    expect(deps.budget.committed()).toBe(PRICE);
  });

  it('409 QUESTION_MISMATCH returns the cap and skips the question', async () => {
    const api = fakeApi(limitedPay(99, apiError(409, 'QUESTION_MISMATCH'))());
    const deps = clientDeps(api);
    const outcome = await askAndPay(Q, deps);
    expect(outcome.kind).toBe('skipped');
    expect(deps.budget.committed()).toBe(0n);
    expect(api.payCalls()).toHaveLength(1);
  });
});

describe('quote errors happen before anything is signed', () => {
  it('429 on the quote waits and tries again', async () => {
    let attempts = 0;
    const handler: Handler = (call, state) => {
      if (call.paymentSignature) return { status: 200, json: result(qidOf(1)) };
      return ++attempts < 3
        ? apiError(429, 'RATE_LIMITED')
        : { status: 402, json: quote({}, state.quotes) };
    };
    const outcome = await askAndPay(Q, clientDeps(fakeApi(handler)));
    expect(attempts).toBe(3);
    expect(outcome.kind).toBe('settled');
  });

  it('keeps answering 429: the run stops without signing', async () => {
    const api = fakeApi(() => apiError(429, 'RATE_LIMITED'));
    const { signer, calls } = countingSigner();
    const outcome = await askAndPay(Q, clientDeps(api, { signer }));
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('RATE_LIMIT');
    expect(api.quoteCalls()).toHaveLength(4);
    expect(calls).toHaveLength(0);
  });

  it('a network error while quoting stops the run', async () => {
    const outcome = await askAndPay(Q, clientDeps(fakeApi(() => NETWORK_ERROR)));
    expect(outcome.kind === 'stopped' && outcome.reason).toBe('ERROR');
  });

  it('a 400 on the quote skips the question', async () => {
    const outcome = await askAndPay(
      Q,
      clientDeps(fakeApi(() => apiError(400, 'VALIDATION_FAILED'))),
    );
    expect(outcome.kind).toBe('skipped');
  });
});
