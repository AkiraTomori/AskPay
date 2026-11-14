// Recovery (A5, system-design §5.6 D and F): every question that still has money in escrow ends on
// chain, whatever happened to the process. A "restart" here is a second app over the same SQLite
// and the same fake chain, with the first one thrown away.
import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { LlmError } from '../../../src/shared/llm.js';
import {
  insertQuote,
  readCheckpoint,
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
    await after.recovery.sweep();

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

      await test.recovery.sweep();
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

  it('scans new blocks only: a second sweep does not read old ranges again', async () => {
    const test = createTestApp();
    await test.recovery.sweep();
    const calls = test.chain.depositedBetween.mock.calls.length;
    await test.recovery.sweep();
    expect(test.chain.depositedBetween.mock.calls.length).toBe(calls); // nothing new to read
    test.chain.block.number += 5;
    await test.recovery.sweep();
    expect(test.chain.depositedBetween.mock.calls.length).toBe(calls + 1);
  });

  it('halves the log range when the RPC refuses it, and still finds the deposit', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    const real = chain.depositedBetween.getMockImplementation();
    chain.depositedBetween.mockImplementation(async (from, to) => {
      if (to - from > 100n) throw new Error('range too large');
      return real ? real(from, to) : [];
    });
    const test = createTestApp({ chain });
    await test.recovery.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Refunded');
  });
});

describe('the deposit scan never hammers the RPC and never stops the server from starting', () => {
  it('a rate limit is not a range problem: one read, no shrinking, and no retry before the backoff', async () => {
    const chain = createFakeChain();
    chain.depositedBetween.mockRejectedValue(
      new Error('HTTP request failed. Status: 429. Too many requests'),
    );
    const test = createTestApp({ chain });

    await test.recovery.sweep();
    expect(chain.depositedBetween).toHaveBeenCalledTimes(1);

    await test.recovery.sweep(); // the next sweep comes too soon
    expect(chain.depositedBetween).toHaveBeenCalledTimes(1);

    test.clock.now += 61_000; // after the first backoff (60 s) it tries once more, with the SAME range
    await test.recovery.sweep();
    expect(chain.depositedBetween).toHaveBeenCalledTimes(2);
    const [first, second] = chain.depositedBetween.mock.calls;
    expect(second).toEqual(first);
  });

  it('the wait grows with every failure', async () => {
    const chain = createFakeChain();
    chain.depositedBetween.mockRejectedValue(new Error('fetch failed'));
    const test = createTestApp({ chain });
    await test.recovery.sweep(); // fails: next try after 60 s
    test.clock.now += 61_000;
    await test.recovery.sweep(); // fails again: next try after 120 s
    test.clock.now += 61_000;
    await test.recovery.sweep(); // still blocked
    expect(chain.depositedBetween).toHaveBeenCalledTimes(2);
    test.clock.now += 60_000;
    await test.recovery.sweep();
    expect(chain.depositedBetween).toHaveBeenCalledTimes(3);
  });

  it('a failing scan does not make startup throw: rows are still reconciled', async () => {
    const chain = createFakeChain();
    chain.depositedBetween.mockRejectedValue(new Error('rate limit'));
    const test = createTestApp({ chain });
    const qid = seed(test, 'ANSWERING');
    chain.plantDeposit(qid);
    await expect(test.recovery.sweep()).resolves.toBeUndefined();
    expect(stageOf(test, qid)).toBe('REFUNDED');
  });

  it('a range error shrinks the range, but stops at the floor instead of asking for ever less', async () => {
    const chain = createFakeChain();
    chain.depositedBetween.mockRejectedValue(new Error('query exceeds max block range'));
    const test = createTestApp({ chain });
    await test.recovery.sweep();
    // 100 -> 50 -> 25 (the floor), then the failure is final.
    expect(chain.depositedBetween.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('reads at most 40 ranges per pass and carries on from where it stopped', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    chain.block.number = 1_500; // 1 + 1500 blocks, in ranges of 10 blocks
    const test = createTestApp({ chain });
    const small = createTestApp({ chain, store: test.store, scanChunk: 10 });
    await small.recovery.sweep();
    expect(chain.depositedBetween).toHaveBeenCalledTimes(40);
    await small.recovery.sweep();
    expect(chain.depositedBetween).toHaveBeenCalledTimes(80);
    // The deposit is in block 1001, not yet reached: 80 ranges of 10 blocks cover blocks 0 to 799.
    expect(chain.questions.get(orphan)?.status).toBe('Open');
    await small.recovery.sweep(); // blocks 800 to 1199
    expect(chain.questions.get(orphan)?.status).toBe('Refunded');
  });
});

describe('startup waits for the rows, not for the scan', () => {
  it('startup reconciles rows and returns without reading any log; the scan starts with start()', async () => {
    const test = createTestApp();
    const qid = seed(test, 'ANSWERING');
    test.chain.plantDeposit(qid);

    await test.recovery.startup();
    expect(stageOf(test, qid)).toBe('REFUNDED'); // rows are done before requests are accepted
    expect(test.chain.depositedBetween).not.toHaveBeenCalled(); // the scan is not

    test.recovery.start();
    await vi.waitFor(() => expect(test.chain.depositedBetween).toHaveBeenCalled());
    test.recovery.stop();
  });
});

describe('the scan checkpoint (system-design §7)', () => {
  it('a restart over the same database continues after the checkpoint', async () => {
    const test = createTestApp();
    await test.recovery.sweep();
    expect(readCheckpoint(test.store)).toBe(BigInt(test.chain.block.number));

    test.chain.block.number += 3;
    const after = restart(test);
    await after.recovery.sweep();
    const lastCall = test.chain.depositedBetween.mock.calls.at(-1);
    expect(lastCall).toEqual([
      BigInt(test.chain.block.number) - 2n,
      BigInt(test.chain.block.number),
    ]);
  });

  it('a lost database has no checkpoint, so the scan starts again at the deployment block', async () => {
    const test = createTestApp();
    await test.recovery.sweep();
    const fresh = createTestApp({ chain: test.chain }); // new, empty database
    expect(readCheckpoint(fresh.store)).toBeUndefined();
    const before = test.chain.depositedBetween.mock.calls.length;
    await fresh.recovery.sweep();
    expect(test.chain.depositedBetween.mock.calls[before]?.[0]).toBe(0n);
  });

  it('without a checkpoint it looks back 24 hours of blocks, not to the deployment block', async () => {
    const chain = createFakeChain();
    chain.block.number = 100_000;
    const test = createTestApp({ chain });
    await test.recovery.sweep();
    expect(chain.depositedBetween.mock.calls[0]?.[0]).toBe(100_000n - 43_200n + 1n);
  });

  it('a Deposited log that could not be handled is not skipped: the cursor stays and it is retried', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    chain.question.mockRejectedValueOnce(new Error('rpc hiccup'));
    const test = createTestApp({ chain });

    await test.recovery.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Open');
    // The cursor stopped before the range holding the failed log, so nothing after it is skipped.
    expect(readCheckpoint(test.store)).toBeLessThan(BigInt(chain.block.number));

    test.clock.now += 61_000; // past the backoff
    await test.recovery.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Refunded');
    expect(readCheckpoint(test.store)).toBe(BigInt(chain.block.number));
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
