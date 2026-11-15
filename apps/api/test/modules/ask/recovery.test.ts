// Recovery (A5, system-design §5.6 D and F): every question that still has money in escrow ends on
// chain, whatever happened to the process. A "restart" here is a second app over the same SQLite
// and the same fake chain, with the first one thrown away.
import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { LlmError } from '../../../src/shared/llm.js';
import {
  insertQuote,
  transitionStage,
  type Patch,
  type Stage,
} from '../../../src/modules/ask/ask.repository.js';
import {
  PRICE,
  QUESTION,
  T0,
  ask,
  createFakeChain,
  createFakeLlm,
  createTestApp,
  rowOf,
  stageOf,
  type FakeChain,
  type TestApp,
} from '../../harness.js';

let counter = 0;
const nextQid = (): Hex => `0x${(++counter + 0xabc000).toString(16).padStart(64, '0')}`;
const sentFns = (chain: FakeChain) => chain.sent.map((tx) => tx.fn);

// A row as an earlier life of the server could have left it.
function seed(
  test: TestApp,
  stage: Stage,
  options: { qid?: Hex; patch?: Patch; quoteExpiresAt?: number } = {},
): Hex {
  const qid = options.qid ?? nextQid();
  insertQuote(
    test.store,
    {
      qid,
      question: QUESTION,
      questionHash: keccak256(toBytes(QUESTION)),
      price: PRICE,
      quoteExpiresAt: options.quoteExpiresAt ?? T0 + 300_000,
    },
    T0,
  );
  if (stage !== 'QUOTED')
    transitionStage(test.store, qid, 'QUOTED', stage, T0, options.patch ?? {});
  return qid;
}

// The process after a restart: same database and chain, fresh memory.
const restart = (test: TestApp, extra: Parameters<typeof createTestApp>[0] = {}) =>
  createTestApp({ store: test.store, chain: test.chain, ...extra });

describe('AP-05-AC08 after a restart every question with money in escrow is handled', () => {
  it('ANSWERING and CHECKING with no verdict are refunded, and the LLM is not run again', async () => {
    const test = createTestApp();
    const answering = seed(test, 'ANSWERING', { patch: { payer: '0x1' } });
    const checking = seed(test, 'CHECKING', { patch: { answer: 'đã trả lời dở dang' } });
    test.chain.plantDeposit(answering);
    test.chain.plantDeposit(checking);

    const after = restart(test);
    await after.recovery.sweep();

    expect(stageOf(after, answering)).toBe('REFUNDED');
    expect(stageOf(after, checking)).toBe('REFUNDED');
    expect(sentFns(test.chain)).toEqual(['refundByProvider', 'refundByProvider']);
    expect(after.llm.state.calls).toHaveLength(0);
    expect(rowOf(after, answering)?.reason).toBe('ANSWER_FAILED');
  });

  it('SETTLING with a stored verdict resends EXACTLY that settle (same signature, same citations)', async () => {
    const chain = createFakeChain();
    const first = createTestApp({ chain });
    // The first process signed the verdict and stored it, then died before the tx went out.
    chain.settle.mockImplementationOnce(async () => ({
      kind: 'not-sent' as const,
      reason: 'rpc down',
      rpcDown: true,
    }));
    const { qid } = await ask(first);
    expect(stageOf(first, qid)).toBe('CHECKING');

    const after = restart(first);
    await after.recovery.sweep();

    expect(stageOf(after, qid)).toBe('PAID');
    const [before, again] = chain.settle.mock.calls.map(([request]) => request);
    expect(again).toEqual(before);
    expect(after.llm.state.calls).toHaveLength(0);
  });

  it('AP-05-AC08 refunds instead of resending once under 60 seconds remain (the cutoff covers restarts too)', async () => {
    const chain = createFakeChain();
    const first = createTestApp({ chain });
    chain.settle.mockImplementationOnce(async () => ({
      kind: 'not-sent' as const,
      reason: 'rpc down',
      rpcDown: true,
    }));
    const { qid } = await ask(first);
    chain.block.time += 550; // 50 s left of the 600 s window

    const after = restart(first);
    await after.recovery.sweep();

    expect(stageOf(after, qid)).toBe('REFUNDED');
    expect(sentFns(chain)).toEqual(['deposit', 'refundByProvider']);
  });

  it('SETTLING with too little stored to resend is refunded', async () => {
    const test = createTestApp();
    const qid = seed(test, 'SETTLING');
    test.chain.plantDeposit(qid);
    const after = restart(test);
    await after.recovery.sweep();
    expect(stageOf(after, qid)).toBe('REFUNDED');
    expect(sentFns(test.chain)).toEqual(['refundByProvider']);
  });

  it('a lost database: money in escrow with no row at all is refunded by the provider', async () => {
    const test = createTestApp();
    const orphan = nextQid();
    test.chain.plantDeposit(orphan); // the DB never heard of it
    const after = createTestApp({ chain: test.chain }); // a brand new, empty database
    await after.indexer.sweep(); // the indexer finds the deposit, recovery decides what it means

    expect(sentFns(test.chain)).toEqual(['refundByProvider']);
    expect(test.chain.questions.get(orphan)?.status).toBe('Refunded');
    expect(after.llm.state.calls).toHaveLength(0);
  });

  it('a question the chain already closed (the payer claimed while the server was down) only updates the DB', async () => {
    const test = createTestApp();
    const qid = seed(test, 'ANSWERING');
    test.chain.plantDeposit(qid);
    const question = test.chain.questions.get(qid);
    if (question) question.status = 'Refunded';

    const after = restart(test);
    await after.recovery.sweep();

    expect(stageOf(after, qid)).toBe('REFUNDED');
    expect(test.chain.sent).toHaveLength(0);
  });

  it('closed questions are left alone and cost no chain read', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const reads = test.chain.question.mock.calls.length;
    const after = restart(test);
    await after.recovery.sweep();
    expect(stageOf(after, qid)).toBe('PAID');
    expect(test.chain.question.mock.calls.length).toBe(reads);
  });
});

describe('AP-03-AC06 a deposit that lands late is still answered or refunded', () => {
  it('DEPOSITING whose deposit arrives with time to spare is answered normally', async () => {
    const chain = createFakeChain();
    chain.deposit.mockImplementationOnce(async () => ({ kind: 'unknown' as const }));
    const test = createTestApp({ chain });
    const { response, qid } = await ask(test);
    expect(response.status).toBe(202);
    expect(stageOf(test, qid)).toBe('DEPOSITING');

    chain.plantDeposit(qid, 600); // the tx mined after the request gave up
    await test.recovery.sweep();

    expect(stageOf(test, qid)).toBe('PAID');
    expect(sentFns(chain)).toEqual(['settle']);
  });

  it('arriving with too little time (under cutoff + pipeline budget) is refunded without answering', async () => {
    const chain = createFakeChain();
    chain.deposit.mockImplementationOnce(async () => ({ kind: 'unknown' as const }));
    const test = createTestApp({ chain });
    const { qid } = await ask(test);

    chain.plantDeposit(qid, 170); // 60 + 120 = 180 s are needed
    await test.recovery.sweep();

    expect(stageOf(test, qid)).toBe('REFUNDED');
    expect(sentFns(chain)).toEqual(['refundByProvider']);
    expect(test.llm.state.calls).toHaveLength(0);
  });

  it('an unknown deposit that never reached the network goes back to QUOTED while the quote lives', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain });
    chain.nonce.latest = 5;
    chain.nonce.pending = 5;
    const qid = seed(test, 'DEPOSITING', {
      patch: { pendingTx: `0x${'a1'.repeat(32)}`, pendingNonce: 5 },
    });

    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('QUOTED');
    expect(rowOf(test, qid)).toMatchObject({ pending_tx: null, pending_nonce: null });
  });

  it('...and to EXPIRED once the authorisation could no longer be used', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain });
    chain.nonce.latest = 5;
    chain.nonce.pending = 5;
    const qid = seed(test, 'DEPOSITING', {
      quoteExpiresAt: T0 - 1,
      patch: { pendingTx: `0x${'a1'.repeat(32)}`, pendingNonce: 5 },
    });
    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('EXPIRED');
  });

  it('a crash before signing (no pending_tx) with nothing held also goes back to QUOTED', async () => {
    const test = createTestApp();
    const qid = seed(test, 'DEPOSITING');
    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('QUOTED');
  });

  it('a deposit still in the mempool is waited for, never replaced or abandoned', async () => {
    const chain = createFakeChain();
    const test = createTestApp({ chain, now: () => T0 + 10 * 60_000 });
    chain.nonce.latest = 5;
    chain.nonce.pending = 6; // in the mempool
    const qid = seed(test, 'DEPOSITING', {
      patch: { pendingTx: `0x${'a1'.repeat(32)}`, pendingNonce: 5 },
    });

    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('DEPOSITING');
    expect(chain.deposit).not.toHaveBeenCalled();
  });
});

describe('§5.6 D a pending tx is resolved by its nonce', () => {
  const pendingTx = `0x${'7e'.repeat(32)}` as Hex;
  const paid = (answerHash: Hex) => ({
    success: true,
    event: { name: 'Paid' as const, answerHash, citationsHash: `0x${'cc'.repeat(32)}` as Hex },
  });

  it('a receipt with a Paid event closes the question as PAID with that tx', async () => {
    const test = createTestApp();
    const qid = seed(test, 'SETTLING', {
      patch: { pendingTx, pendingNonce: 3, answerHash: `0x${'aa'.repeat(32)}` },
    });
    test.chain.plantDeposit(qid);
    const question = test.chain.questions.get(qid);
    if (question) question.status = 'Paid';
    test.chain.receipts.set(pendingTx, paid(`0x${'aa'.repeat(32)}`));

    await test.recovery.sweep();
    expect(rowOf(test, qid)).toMatchObject({
      stage: 'PAID',
      settle_tx: pendingTx,
      pending_tx: null,
    });
  });

  it("a receipt with a Refunded event closes it as REFUNDED with the chain's reason", async () => {
    const test = createTestApp();
    const qid = seed(test, 'SETTLING', { patch: { pendingTx, pendingNonce: 3 } });
    test.chain.plantDeposit(qid);
    const question = test.chain.questions.get(qid);
    if (question) question.status = 'Refunded';
    test.chain.receipts.set(pendingTx, {
      success: true,
      event: { name: 'Refunded', reason: 'INVALID_CITATION' },
    });
    await test.recovery.sweep();
    expect(rowOf(test, qid)).toMatchObject({ stage: 'REFUNDED', reason: 'INVALID_CITATION' });
  });

  it('a spent nonce without a receipt of ours (the replacement mined) follows the chain status', async () => {
    const test = createTestApp();
    const qid = seed(test, 'SETTLING', { patch: { pendingTx, pendingNonce: 3 } });
    test.chain.plantDeposit(qid);
    const question = test.chain.questions.get(qid);
    if (question) question.status = 'Refunded';
    test.chain.nonce.latest = 4;
    test.chain.nonce.pending = 4;

    await test.recovery.sweep();
    expect(stageOf(test, qid)).toBe('REFUNDED');
    expect(test.chain.sent).toHaveLength(0);
  });

  it('a tx dropped from the mempool is cleared and the stored settle is resent', async () => {
    const chain = createFakeChain();
    const first = createTestApp({ chain });
    chain.settle.mockImplementationOnce(async (request, _choose, hooks) => {
      hooks?.onSigned?.({ hash: pendingTx, nonce: 3, replacement: false });
      return { kind: 'unknown' as const, hash: pendingTx };
    });
    const { qid } = await ask(first);
    expect(rowOf(first, qid)).toMatchObject({ stage: 'SETTLING', pending_nonce: 3 });
    chain.nonce.latest = 3; // nonce 3 was never used: the tx is gone
    chain.nonce.pending = 3;

    await first.recovery.sweep();
    expect(stageOf(first, qid)).toBe('PAID');
  });

  it('a tx still in the mempool is waited for under 30 s and replaced once after', async () => {
    const chain = createFakeChain();
    let now = T0;
    const first = createTestApp({ chain, now: () => now });
    chain.settle.mockImplementationOnce(async (request, _choose, hooks) => {
      hooks?.onSigned?.({ hash: pendingTx, nonce: 3, replacement: false });
      return { kind: 'unknown' as const, hash: pendingTx };
    });
    await ask(first);
    chain.nonce.latest = 3;
    chain.nonce.pending = 4; // in the mempool

    now = T0 + 10_000;
    await first.recovery.sweep();
    expect(chain.settle).toHaveBeenCalledTimes(1); // too early to replace

    // The fake settle would mine the replacement at once; hold it back to see a second sweep.
    now = T0 + 31_000;
    chain.settle.mockImplementationOnce(async () => ({ kind: 'unknown' as const, stuck: true }));
    await first.recovery.sweep();
    expect(chain.settle).toHaveBeenCalledTimes(2);
    const hooks = chain.settle.mock.calls[1]?.[2];
    expect(hooks?.replace).toEqual({
      nonce: 3,
      fees: { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
    });

    now = T0 + 90_000;
    await first.recovery.sweep();
    expect(chain.settle).toHaveBeenCalledTimes(2); // only one replacement per question
  });
});

describe('§5.6 F a deposit nobody is answering is refunded, not left for the payer to claim', () => {
  it.each(['QUOTED', 'EXPIRED'] as const)(
    'a Deposited log for a %s question is refunded as ORPHAN_DEPOSIT',
    async (stage) => {
      const test = createTestApp();
      const qid = seed(test, stage);
      test.chain.plantDeposit(qid);

      await test.indexer.sweep();
      expect(stageOf(test, qid)).toBe('REFUNDED');
      expect(sentFns(test.chain)).toEqual(['refundByProvider']);
      expect(test.llm.state.calls).toHaveLength(0);
    },
  );

  it('ignores a Deposited log for a question a pipeline already knows', async () => {
    const test = createTestApp();
    const qid = seed(test, 'ANSWERING');
    test.chain.plantDeposit(qid);
    // A Deposited log for a question that is already past DEPOSITING belongs to its pipeline, so the
    // log handler must not treat it as an orphan (rows are reconciled by a different path).
    await test.recovery.onDeposited(qid);
    expect(test.chain.sent).toHaveLength(0);
  });

  it('the indexer entry onDeposited handles a log directly', async () => {
    const test = createTestApp();
    const qid = seed(test, 'QUOTED');
    test.chain.plantDeposit(qid);
    await test.recovery.onDeposited(qid);
    expect(stageOf(test, qid)).toBe('REFUNDED');
  });
});

describe('recovery leaves a live pipeline alone', () => {
  it('a sweep during the LLM call refunds nothing; the question still ends PAID', async () => {
    const llm = createFakeLlm();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const answer = llm.state.answer;
    llm.state.answer = (request) => answer(request);
    llm.complete.mockImplementation(async (request) => {
      llm.state.calls.push(request);
      const isJudge = request.system.includes('judgements');
      if (!isJudge) await gate;
      return (isJudge ? llm.state.judge : llm.state.answer)(request);
    });
    const test = createTestApp({ llm, requestWaitMs: 20 });
    const { qid } = await ask(test);
    expect(stageOf(test, qid)).toBe('ANSWERING');

    await test.recovery.sweep(); // would refund an ANSWERING row if it did not know it is live
    expect(test.chain.sent.map((tx) => tx.fn)).toEqual(['deposit']);

    release();
    await vi.waitFor(() => expect(stageOf(test, qid)).toBe('PAID'));
  });

  it('after a pipeline crash the held question is released and the next sweep takes it', async () => {
    const llm = createFakeLlm();
    llm.state.answer = () => {
      throw new LlmError('network');
    };
    const test = createTestApp({ llm });
    const { qid } = await ask(test);
    // The LLM failed twice, so the pipeline refunded already; nothing is left for recovery.
    expect(stageOf(test, qid)).toBe('REFUNDED');
    await test.recovery.sweep();
    expect(test.chain.sent.map((tx) => tx.fn)).toEqual(['deposit', 'refundByProvider']);
  });
});
