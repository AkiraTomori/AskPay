// The event indexer (A6, T-09, system-design §7): one scan over the escrow's logs that fills
// chain_events and hands deposits and closings to the ask module. These are the scan tests A5 wrote
// against recovery, moved with their assertions; what each log MEANS stays in recovery.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import {
  insertQuote,
  transitionStage,
  type Patch,
  type Stage,
} from '../../../src/modules/ask/ask.repository.js';
import { readCheckpoint } from '../../../src/modules/indexer/indexer.repository.js';
import {
  PRICE,
  QUESTION,
  T0,
  createFakeChain,
  createTestApp,
  stageOf,
  type TestApp,
} from '../../harness.js';

let counter = 0;
const nextQid = (): Hex => `0x${(++counter + 0xdef000).toString(16).padStart(64, '0')}`;

// A row as an earlier life of the server could have left it.
function seed(test: TestApp, stage: Stage, options: { qid?: Hex; patch?: Patch } = {}): Hex {
  const qid = options.qid ?? nextQid();
  insertQuote(
    test.store,
    {
      qid,
      question: QUESTION,
      questionHash: keccak256(toBytes(QUESTION)),
      price: PRICE,
      quoteExpiresAt: T0 + 300_000,
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

describe('the indexer reads the chain in ranges (T-09)', () => {
  it('scans new blocks only: a second sweep does not read old ranges again', async () => {
    const test = createTestApp();
    await test.indexer.sweep();
    const calls = test.chain.eventsBetween.mock.calls.length;
    await test.indexer.sweep();
    expect(test.chain.eventsBetween.mock.calls.length).toBe(calls); // nothing new to read
    test.chain.block.number += 5;
    await test.indexer.sweep();
    expect(test.chain.eventsBetween.mock.calls.length).toBe(calls + 1);
  });

  it('halves the log range when the RPC refuses it, and still finds the deposit', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    const real = chain.eventsBetween.getMockImplementation();
    chain.eventsBetween.mockImplementation(async (from, to) => {
      if (to - from > 100n) throw new Error('range too large');
      return real ? real(from, to) : [];
    });
    const test = createTestApp({ chain });
    await test.indexer.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Refunded');
  });
});

describe('the deposit scan never hammers the RPC and never stops the server from starting', () => {
  it('a rate limit is not a range problem: one read, no shrinking, and no retry before the backoff', async () => {
    const chain = createFakeChain();
    chain.eventsBetween.mockRejectedValue(
      new Error('HTTP request failed. Status: 429. Too many requests'),
    );
    const test = createTestApp({ chain });

    await test.indexer.sweep();
    expect(chain.eventsBetween).toHaveBeenCalledTimes(1);

    await test.indexer.sweep(); // the next sweep comes too soon
    expect(chain.eventsBetween).toHaveBeenCalledTimes(1);

    test.clock.now += 61_000; // after the first backoff (60 s) it tries once more, with the SAME range
    await test.indexer.sweep();
    expect(chain.eventsBetween).toHaveBeenCalledTimes(2);
    const [first, second] = chain.eventsBetween.mock.calls;
    expect(second).toEqual(first);
  });

  it('the wait grows with every failure', async () => {
    const chain = createFakeChain();
    chain.eventsBetween.mockRejectedValue(new Error('fetch failed'));
    const test = createTestApp({ chain });
    await test.indexer.sweep(); // fails: next try after 60 s
    test.clock.now += 61_000;
    await test.indexer.sweep(); // fails again: next try after 120 s
    test.clock.now += 61_000;
    await test.indexer.sweep(); // still blocked
    expect(chain.eventsBetween).toHaveBeenCalledTimes(2);
    test.clock.now += 60_000;
    await test.indexer.sweep();
    expect(chain.eventsBetween).toHaveBeenCalledTimes(3);
  });

  it('a failing scan does not make startup throw: rows are still reconciled', async () => {
    const chain = createFakeChain();
    chain.eventsBetween.mockRejectedValue(new Error('rate limit'));
    const test = createTestApp({ chain });
    const qid = seed(test, 'ANSWERING');
    chain.plantDeposit(qid);
    await expect(test.indexer.sweep()).resolves.toBeUndefined();
    await test.recovery.startup(); // reconciling rows does not depend on the scan
    expect(stageOf(test, qid)).toBe('REFUNDED');
  });

  it('a range error shrinks the range, but stops at the floor instead of asking for ever less', async () => {
    const chain = createFakeChain();
    chain.eventsBetween.mockRejectedValue(new Error('query exceeds max block range'));
    const test = createTestApp({ chain });
    await test.indexer.sweep();
    // 100 -> 50 -> 25 (the floor), then the failure is final.
    expect(chain.eventsBetween.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('reads at most 40 ranges per pass and carries on from where it stopped', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    chain.block.number = 1_500; // 1 + 1500 blocks, in ranges of 10 blocks
    const test = createTestApp({ chain });
    const small = createTestApp({ chain, store: test.store, scanChunk: 10 });
    await small.indexer.sweep();
    expect(chain.eventsBetween).toHaveBeenCalledTimes(40);
    await small.indexer.sweep();
    expect(chain.eventsBetween).toHaveBeenCalledTimes(80);
    // The deposit is in block 1001, not yet reached: 80 ranges of 10 blocks cover blocks 0 to 799.
    expect(chain.questions.get(orphan)?.status).toBe('Open');
    await small.indexer.sweep(); // blocks 800 to 1199
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
    expect(test.chain.eventsBetween).not.toHaveBeenCalled(); // the scan is not

    test.indexer.start();
    await vi.waitFor(() => expect(test.chain.eventsBetween).toHaveBeenCalled());
    test.indexer.stop();
  });
});

describe('the scan checkpoint (system-design §7)', () => {
  it('a restart over the same database continues after the checkpoint', async () => {
    const test = createTestApp();
    await test.indexer.sweep();
    expect(readCheckpoint(test.store)).toBe(BigInt(test.chain.block.number));

    test.chain.block.number += 3;
    const after = restart(test);
    await after.indexer.sweep();
    const lastCall = test.chain.eventsBetween.mock.calls.at(-1);
    expect(lastCall).toEqual([
      BigInt(test.chain.block.number) - 2n,
      BigInt(test.chain.block.number),
    ]);
  });

  it('a lost database has no checkpoint, so the scan starts again at the deployment block', async () => {
    const test = createTestApp();
    await test.indexer.sweep();
    const fresh = createTestApp({ chain: test.chain }); // new, empty database
    expect(readCheckpoint(fresh.store)).toBeUndefined();
    const before = test.chain.eventsBetween.mock.calls.length;
    await fresh.indexer.sweep();
    expect(test.chain.eventsBetween.mock.calls[before]?.[0]).toBe(0n);
  });

  it('without a checkpoint it looks back 24 hours of blocks, not to the deployment block', async () => {
    const chain = createFakeChain();
    chain.block.number = 100_000;
    const test = createTestApp({ chain });
    await test.indexer.sweep();
    expect(chain.eventsBetween.mock.calls[0]?.[0]).toBe(100_000n - 43_200n + 1n);
  });

  it('a Deposited log that could not be handled is not skipped: the cursor stays and it is retried', async () => {
    const chain = createFakeChain();
    const orphan = nextQid();
    chain.plantDeposit(orphan);
    chain.question.mockRejectedValueOnce(new Error('rpc hiccup'));
    const test = createTestApp({ chain });

    await test.indexer.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Open');
    // The cursor stopped before the range holding the failed log, so nothing after it is skipped.
    expect(readCheckpoint(test.store)).toBeLessThan(BigInt(chain.block.number));

    test.clock.now += 61_000; // past the backoff
    await test.indexer.sweep();
    expect(chain.questions.get(orphan)?.status).toBe('Refunded');
    await test.indexer.sweep(); // the refund made a block of its own; one more pass reaches it
    expect(readCheckpoint(test.store)).toBe(BigInt(chain.block.number));
  });
});

describe('the event index (A6, system-design §7)', () => {
  it("does not resume from A5's Deposited-only checkpoint: earlier Paid and Refunded logs would be missed", async () => {
    const test = createTestApp();
    // An existing database from A5: its scan had reached the head, but kept no events.
    test.store
      .prepare('INSERT INTO indexer_checkpoint (id, last_block) VALUES (1, ?)')
      .run(test.chain.block.number);
    await test.indexer.sweep();
    expect(test.chain.eventsBetween.mock.calls[0]?.[0]).toBe(0n); // the window start, not the old block + 1
    expect(test.store.prepare('SELECT last_block FROM indexer_checkpoint').get()).toEqual({
      last_block: test.chain.block.number,
    }); // and the old row is left as it was
  });

  it('stores every log of a range once, so reading a range twice adds nothing', async () => {
    const test = createTestApp();
    const qid = nextQid();
    test.chain.plantDeposit(qid);
    test.chain.claimRefund(qid);
    await test.indexer.sweep();
    const count = () =>
      (test.store.prepare('SELECT COUNT(*) AS n FROM chain_events').get() as { n: number }).n;
    expect(count()).toBe(2);
    test.store.exec('DELETE FROM event_index_checkpoint');
    await restart(test).indexer.sweep(); // the same range, read again
    expect(count()).toBe(2);
  });
});
