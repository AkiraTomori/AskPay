// The pipeline after the deposit: answer, check, settle (A5, system-design §5.6 B). The escrow is a
// stateful fake that verifies signatures and Merkle proofs like the contract, so each test reads
// the chain's own verdict: Paid, or the reason it refunded.
import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeHeader, paymentResponseSchema } from '@askpay/shared/x402';
import { hashText } from '@askpay/shared/leaf';
import { LlmError } from '../../../src/shared/llm.js';
import { NO_BASIS_ANSWER } from '../../../src/modules/answer/answer.service.js';
import {
  ask,
  createFakeChain,
  createFakeLlm,
  corpus,
  createTestApp,
  rowOf,
  stageOf,
  type FakeChain,
} from '../../harness.js';

const NO_BASIS_QUESTION = 'Cách nấu phở bò ngon tại nhà như thế nào?';
const sentFns = (chain: FakeChain) => chain.sent.map((tx) => tx.fn);

describe('AP-05-AC01 a verified answer is settled as Paid', () => {
  it('answers 200 PAID with the cited Khoản, after exactly one deposit and one settle', async () => {
    const test = createTestApp();
    const { response, qid } = await ask(test);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      qid,
      stage: 'PAID',
      status: 'PAID',
      answer: 'Theo Điều 25 Khoản 2, thời gian thử việc tối đa là 60 ngày.',
      noBasis: false,
    });
    expect(response.body.data.citations).toHaveLength(1);
    expect(response.body.data.citations[0]).toMatchObject({ dieu: 25, khoan: 2 });
    expect(response.body.data.citations[0].text).toContain('Không quá 60 ngày');
    // The Paid log was read from the receipt and the content hashes to it (A6, AP-07-AC02).
    expect(response.body.data.citations[0].verifiedOnChain).toBe(true);
    expect(sentFns(test.chain)).toEqual(['deposit', 'settle']);
  });

  it('commits to what it showed: stored hashes equal the hashes of the answer and the quotes', async () => {
    const test = createTestApp();
    const { response, qid } = await ask(test);
    const data = response.body.data;
    expect(data.answerHash).toBe(hashText(data.answer));
    expect(data.citations[0].quoteHash).toBe(hashText(data.citations[0].quote));
    const row = rowOf(test, qid);
    expect(row).toMatchObject({ stage: 'PAID', verdict_pass: 1, answer_hash: data.answerHash });
    expect(row?.checker_sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(row?.pending_tx).toBeNull();
  });

  it('records the settle tx from the Paid event and returns it in PAYMENT-RESPONSE', async () => {
    const test = createTestApp();
    const { response, qid } = await ask(test);
    const settle = test.chain.sent.find((tx) => tx.fn === 'settle');
    expect(rowOf(test, qid)?.settle_tx).toBe(settle?.hash);
    expect(decodeHeader(paymentResponseSchema, response.headers['payment-response'])).toMatchObject(
      {
        success: true,
        settleTransaction: settle?.hash,
      },
    );
  });
});

describe('AP-05-AC02 no basis or no citation is refunded as NO_CITATION, without the checker', () => {
  it('settles with an empty list (not refundByProvider) and never calls the judge', async () => {
    const test = createTestApp();
    const { response } = await ask(test, NO_BASIS_QUESTION);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      stage: 'REFUNDED',
      status: 'REFUNDED',
      reason: 'NO_CITATION',
      answer: NO_BASIS_ANSWER,
      noBasis: true,
    });
    expect(response.body.data.citations).toEqual([]);
    expect(sentFns(test.chain)).toEqual(['deposit', 'settle']);
    expect(test.llm.judgeCalls()).toBe(0);
    const [call] = test.chain.settle.mock.calls;
    expect(call?.[0]).toMatchObject({ citations: [], proofs: [] });
  });

  it('a model answer whose every citation was dropped is also NO_CITATION', async () => {
    const llm = createFakeLlm();
    llm.state.answer = () =>
      JSON.stringify({
        noBasis: false,
        answer: 'Theo Điều 999.',
        citations: [{ candidateId: 'C99', quote: 'không có thật trong danh sách' }],
      });
    const test = createTestApp({ llm });
    const { response } = await ask(test);
    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'NO_CITATION' });
    expect(llm.judgeCalls()).toBe(0);
  });
});

describe('AP-05-AC04 a rejected verdict is signed and the chain refunds CHECKER_REJECTED', () => {
  it('judge says "no": settle goes out with pass=false and a signature the chain accepts', async () => {
    const llm = createFakeLlm();
    llm.state.judge = () => JSON.stringify({ judgements: [{ id: 'K1', relevant: 'no' }] });
    const test = createTestApp({ llm });
    const { response, qid } = await ask(test);

    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'CHECKER_REJECTED' });
    expect(sentFns(test.chain)).toEqual(['deposit', 'settle']);
    expect(test.chain.settle.mock.calls[0]?.[0]).toMatchObject({ pass: false });
    expect(rowOf(test, qid)).toMatchObject({ verdict_pass: 0, reason: 'CHECKER_REJECTED' });
  });

  it('a quote that is not in the law is rejected the same way (C2), without asking the judge', async () => {
    const llm = createFakeLlm();
    const original = llm.state.answer;
    llm.state.answer = (request) =>
      original(request).replace(
        /"quote":"[^"]*"/,
        '"quote":"Thử việc tối đa 90 ngày với mọi công việc"',
      );
    const test = createTestApp({ llm });
    const { response } = await ask(test);
    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'CHECKER_REJECTED' });
    expect(llm.judgeCalls()).toBe(0);
  });
});

describe('AP-05-AC03 a citation the chain cannot prove is refunded INVALID_CITATION', () => {
  const DEMO = '#demo-fake Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?';

  it('DEMO_FAKE_CITATION: the checker signs pass=true, and the chain still refunds', async () => {
    const test = createTestApp({ demoFakeCitation: true });
    const { response, qid } = await ask(test, DEMO);

    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'INVALID_CITATION' });
    // The checker really passed it (pass=true, judge asked): only the chain caught the fake.
    expect(test.chain.settle.mock.calls[0]?.[0]).toMatchObject({ pass: true });
    expect(test.llm.judgeCalls()).toBe(1);
    // What was signed and stored is the FAKE textHash, not the real Khoản's: that is the whole point.
    const stored = JSON.parse(String(rowOf(test, qid)?.citations_json));
    expect(stored[0].textHash).not.toBe(corpus.find(25, 2)?.textHash);
    expect(stored[0].textHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('the demo prefix does nothing unless the environment flag is on', async () => {
    const test = createTestApp({ demoFakeCitation: false });
    const { response } = await ask(test, DEMO);
    expect(response.body.data).toMatchObject({ stage: 'PAID' });
  });

  it('the flag alone does nothing for an ordinary question', async () => {
    const test = createTestApp({ demoFakeCitation: true });
    const { response } = await ask(test);
    expect(response.body.data).toMatchObject({ stage: 'PAID' });
  });

  it('the demo question is answered without its prefix', async () => {
    const test = createTestApp({ demoFakeCitation: true });
    await ask(test, DEMO);
    expect(test.llm.state.calls[0]?.user).not.toContain('#demo-fake');
  });
});

describe('AP-05-AC05 a verdict the chain does not accept never settles', () => {
  it('a checker key that is not the escrow checker: SETTLE_BUG, refunded ANSWER_FAILED, no Paid', async () => {
    const wrong = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    const test = createTestApp({ checkerSigner: wrong });
    const { response } = await ask(test);

    // Table B: a deterministic revert is not retried. The provider refunds instead.
    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'ANSWER_FAILED' });
    expect(sentFns(test.chain)).toEqual(['deposit', 'refundByProvider']);
  });
});

describe('AP-04-AC04 an LLM that fails after the money is held refunds ANSWER_FAILED', () => {
  it('two failed calls: refundByProvider, answered as a refund and not as a 5xx', async () => {
    const llm = createFakeLlm();
    llm.state.answer = () => {
      throw new LlmError('timeout');
    };
    const test = createTestApp({ llm });
    const { response } = await ask(test);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'ANSWER_FAILED' });
    expect(sentFns(test.chain)).toEqual(['deposit', 'refundByProvider']);
    expect(llm.state.calls).toHaveLength(2); // one retry, no more
  });
});

describe('AP-04-AC05 a checker that fails after the money is held refunds ANSWER_FAILED', () => {
  it('judge fails twice: refundByProvider, never a signed pass=false and never CHECKER_REJECTED', async () => {
    const llm = createFakeLlm();
    llm.state.judge = () => {
      throw new LlmError('rate-limited', 429);
    };
    const test = createTestApp({ llm });
    const { response } = await ask(test);

    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'ANSWER_FAILED' });
    expect(sentFns(test.chain)).toEqual(['deposit', 'refundByProvider']);
    expect(test.chain.settle).not.toHaveBeenCalled();
  });
});

describe('AP-05-AC08 §5.6 B the cutoff: near the deadline the provider refunds instead of settling', () => {
  it('under 60 seconds left (measured on the block, not the server clock) signs a refund', async () => {
    const llm = createFakeLlm();
    // The answer took so long that the next block is 560 s on: 40 s left of a 600 s window.
    const test = createTestApp({ llm });
    llm.state.judge = () => {
      test.chain.block.time += 560;
      return JSON.stringify({ judgements: [{ id: 'K1', relevant: 'yes' }] });
    };
    const { response } = await ask(test);

    expect(response.body.data).toMatchObject({ stage: 'REFUNDED', reason: 'ANSWER_FAILED' });
    expect(sentFns(test.chain)).toEqual(['deposit', 'refundByProvider']);
  });

  it.each([
    [60, 'settle'],
    [59, 'refundByProvider'],
  ])('with %i seconds left it sends %s (the cutoff is exactly 60)', async (left, fn) => {
    const test = createTestApp();
    test.llm.state.judge = () => {
      for (const question of test.chain.questions.values()) {
        question.deadline = test.chain.block.time + left;
      }
      return JSON.stringify({ judgements: [{ id: 'K1', relevant: 'yes' }] });
    };
    await ask(test);
    expect(sentFns(test.chain)).toEqual(['deposit', fn]);
  });

  it('does not look at the server clock', async () => {
    const test = createTestApp();
    test.clock.now += 10 * 60 * 60 * 1000; // ten hours later by the server clock
    const { response } = await ask(test);
    expect(response.body.data).toMatchObject({ stage: 'PAID' });
  });
});

describe('§5.6 B the chain already closed the question', () => {
  it('settle simulation reverts QuestionNotOpen (payer claimed): no tx sent, DB follows the chain', async () => {
    const llm = createFakeLlm();
    const test = createTestApp({ llm });
    llm.state.judge = () => {
      // The payer's claimRefund mined while the checker was thinking.
      for (const question of test.chain.questions.values()) question.status = 'Refunded';
      return JSON.stringify({ judgements: [{ id: 'K1', relevant: 'yes' }] });
    };
    const { response, qid } = await ask(test);

    expect(sentFns(test.chain)).toEqual(['deposit']);
    expect(stageOf(test, qid)).toBe('REFUNDED');
    expect(response.status).toBe(200);
  });

  it('NotProvider: nothing can be sent, the question stays open for the payer to claim', async () => {
    const chain = createFakeChain();
    chain.settle.mockImplementation(async () => ({
      kind: 'not-sent' as const,
      reason: 'reverted',
      errorName: 'NotProvider',
    }));
    const test = createTestApp({ chain });
    const { response, qid } = await ask(test);

    expect(response.status).toBe(202);
    expect(['CHECKING', 'SETTLING']).toContain(stageOf(test, qid));
    expect(chain.questions.get(qid)?.status).toBe('Open');
  });
});

describe('§5.6 C pending_tx is written before the tx is sent', () => {
  it('stores hash and nonce with the stage change SETTLING at signing time', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain });
    let seen: Record<string, unknown> | undefined;
    chain.settle.mockImplementation(async (request, _choose, hooks) => {
      hooks?.onSigned?.({ hash: `0x${'5e'.repeat(32)}`, nonce: 41, replacement: false });
      seen = rowOf(test, request.qid);
      return { kind: 'unknown' as const, hash: `0x${'5e'.repeat(32)}` };
    });
    const { response, qid } = await ask(test);

    expect(seen).toMatchObject({
      stage: 'SETTLING',
      pending_tx: `0x${'5e'.repeat(32)}`,
      pending_nonce: 41,
    });
    // Unknown outcome: nothing is lost and nothing is claimed. The tx stays pending for recovery.
    expect(response.status).toBe(202);
    expect(rowOf(test, qid)).toMatchObject({ stage: 'SETTLING', pending_nonce: 41 });
  });
});

describe('the request wait (T-07) and a pipeline that outlives it', () => {
  it('answers 202 with the stage after the wait, and the pipeline still finishes the question', async () => {
    const llm = createFakeLlm();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = llm.state.answer;
    llm.complete.mockImplementation(async (request) => {
      llm.state.calls.push(request);
      if (request.system.includes('Trả về DUY NHẤT') && !request.system.includes('judgements')) {
        await gate;
      }
      return (request.system.includes('judgements') ? llm.state.judge : original)(request);
    });
    const test = createTestApp({ llm, requestWaitMs: 20 });
    const { response, qid } = await ask(test);

    expect(response.status).toBe(202);
    expect(response.body.data).toEqual({ qid, stage: 'ANSWERING' });
    expect(stageOf(test, qid)).toBe('ANSWERING');

    release();
    await vi.waitFor(() => expect(stageOf(test, qid)).toBe('PAID'));
  });

  it('an unexpected error inside the pipeline is contained: 202, no crash, recovery can finish it', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain });
    const real = chain.settle.getMockImplementation();
    chain.settle.mockImplementationOnce(async () => {
      throw new Error('RPC exploded');
    });
    const { response, qid } = await ask(test);

    expect(response.status).toBe(202);
    expect(stageOf(test, qid)).toBe('CHECKING');
    // Nothing was lost: the verdict is stored, so the next sweep settles it.
    if (real) chain.settle.mockImplementation(real);
    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('PAID');
  });
});

describe('a not-sent settle is retried by recovery with exactly the stored settle', () => {
  it('a node that refused the first send: the second send has the same signature and citations', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain });
    const real = chain.settle.getMockImplementation();
    chain.settle.mockImplementationOnce(async () => ({
      kind: 'not-sent' as const,
      reason: 'rpc down',
      rpcDown: true,
    }));
    const { response, qid } = await ask(test);
    expect(response.status).toBe(202);

    if (real) chain.settle.mockImplementation(real);
    await test.recovery.sweep();

    expect(stageOf(test, qid)).toBe('PAID');
    const [first, second] = chain.settle.mock.calls.map(([request]) => request);
    expect(second).toEqual(first);
  });
});
