// GET /questions/:qid and the ✓ on a citation card (A6, AP-07-AC02, AP-07-AC03, system-design §7).
// The mark must survive an edit of the database only if the edit is invisible to the chain, which
// no edit is: every case below changes the database and expects the mark to go out.
import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { citationsHash, hashText } from '@askpay/shared/leaf';
import { questionResultSchema } from '@askpay/shared/api';
import { createLogger } from '../../../src/shared/logger.js';
import {
  PRICE,
  QUESTION,
  T0,
  ask,
  corpus,
  createFakeLlm,
  createTestApp,
  rowOf,
  type TestApp,
} from '../../harness.js';
import { insertQuote, transitionStage } from '../../../src/modules/ask/ask.repository.js';

const get = (test: TestApp, qid: string) => test.api.get(`/api/questions/${qid}`);
const marks = (body: { data: { citations: { verifiedOnChain: boolean }[] } }) =>
  body.data.citations.map((citation) => citation.verifiedOnChain);

interface StoredCitationJson {
  quote: string;
  quoteHash: string;
  textHash: string;
}
// Edits the first (only) citation of the stored row, as someone with write access to the file could.
function editCitation(test: TestApp, qid: string, edit: (citation: StoredCitationJson) => void) {
  const json = JSON.parse(String(rowOf(test, qid)?.citations_json)) as StoredCitationJson[];
  const [first] = json;
  if (!first) throw new Error('the question has no stored citation');
  edit(first);
  test.store
    .prepare('UPDATE questions SET citations_json = ? WHERE qid = ?')
    .run(JSON.stringify(json), qid);
}
const setColumn = (test: TestApp, qid: string, column: string, value: string) =>
  test.store.prepare(`UPDATE questions SET ${column} = ? WHERE qid = ?`).run(value, qid);

// A process that has not read any receipt yet: the verifier's cache is per process.
const restart = (test: TestApp, extra: Parameters<typeof createTestApp>[0] = {}) =>
  createTestApp({ store: test.store, chain: test.chain, ...extra });

describe('AP-07-AC02 verifiedOnChain is recomputed from the receipt, never trusted from the database', () => {
  it('a PAID question shows the mark on every card, in the 200 and in GET', async () => {
    const test = createTestApp();
    const { response, qid } = await ask(test);
    expect(marks(response.body)).toEqual([true]);

    const read = await get(test, qid);
    expect(read.status).toBe(200);
    expect(questionResultSchema.parse(read.body.data).status).toBe('PAID');
    expect(marks(read.body)).toEqual([true]);
  });

  it('a different process reads the receipt over RPC itself and reaches the same verdict', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const other = restart(test);
    expect(other.chain.receiptOf).toHaveBeenCalledTimes(0);
    expect(marks((await get(other, qid)).body)).toEqual([true]);
    expect(other.chain.receiptOf).toHaveBeenCalledTimes(1);
    await get(other, qid);
    expect(other.chain.receiptOf).toHaveBeenCalledTimes(1); // the event is cached, not re-read
  });

  it('editing ONLY the quote (the stored quoteHash left alone) turns the mark off', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    editCitation(test, qid, (citation) => {
      citation.quote = `${citation.quote} (đã sửa)`;
    });
    expect(marks((await get(test, qid)).body)).toEqual([false]);
  });

  it('editing ONLY the answer turns the mark off', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    setColumn(test, qid, 'answer', 'Thời gian thử việc tối đa là 90 ngày.');
    expect(marks((await get(test, qid)).body)).toEqual([false]);
  });

  it('editing the stored textHash (a card about some other text) turns the mark off', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    editCitation(test, qid, (citation) => {
      citation.textHash = keccak256(toBytes('some other Khoản'));
    });
    expect(marks((await get(test, qid)).body)).toEqual([false]);
  });

  it('editing questions AND chain_events consistently still turns it off, and logs CITATIONS_MISMATCH', async () => {
    const logger = createLogger('silent');
    const errors = vi.spyOn(logger, 'error');
    const test = createTestApp({ logger });
    const { qid } = await ask(test);
    await test.indexer.sweep(); // chain_events now holds the real Paid log

    // The forger rewrites the answer and the quote, then makes both tables agree with the forgery.
    const forgedAnswer = 'Thời gian thử việc tối đa là 90 ngày.';
    editCitation(test, qid, (citation) => {
      citation.quote = `${citation.quote} (đã sửa)`;
      citation.quoteHash = hashText(citation.quote);
    });
    setColumn(test, qid, 'answer', forgedAnswer);
    const row = rowOf(test, qid);
    const stored = JSON.parse(String(row?.citations_json)) as {
      lawId: Hex;
      dieu: number;
      khoan: number;
      textHash: Hex;
      quoteHash: Hex;
    }[];
    const forgedHash = citationsHash(stored);
    setColumn(test, qid, 'citations_hash', forgedHash);
    setColumn(test, qid, 'answer_hash', hashText(forgedAnswer));
    const paid = test.store
      .prepare("SELECT tx_hash, log_index, args_json FROM chain_events WHERE name = 'Paid'")
      .get() as { tx_hash: string; log_index: number; args_json: string };
    const args = JSON.parse(paid.args_json) as Record<string, string>;
    args.citationsHash = forgedHash;
    args.answerHash = hashText(forgedAnswer);
    test.store
      .prepare('UPDATE chain_events SET args_json = ? WHERE tx_hash = ? AND log_index = ?')
      .run(JSON.stringify(args), paid.tx_hash, paid.log_index);

    const read = await get(test, qid);
    expect(marks(read.body)).toEqual([false]);
    expect(read.body.data.status).toBe('PAID'); // the money is what the chain says; only the mark is off
    expect(errors).toHaveBeenCalledWith({ qid }, expect.stringContaining('CITATIONS_MISMATCH'));
  });

  it("pointing settle_tx at ANOTHER question's Paid tx does not borrow its proof", async () => {
    const test = createTestApp();
    const first = await ask(test);
    const second = await ask(test);
    const otherTx = String(rowOf(test, second.qid)?.settle_tx);
    setColumn(test, first.qid, 'settle_tx', otherTx);
    // A new process: nothing cached, so the receipt is read for the edited hash.
    const read = await get(restart(test), first.qid);
    expect(marks(read.body)).toEqual([false]);
    // ...while the second question, untouched, is still verified.
    expect(marks((await get(restart(test), second.qid)).body)).toEqual([true]);
  });

  it('is not cached as a verdict: true, then an edit, then false', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    expect(marks((await get(test, qid)).body)).toEqual([true]);
    setColumn(test, qid, 'answer', 'Một câu trả lời đã bị đổi.');
    expect(marks((await get(test, qid)).body)).toEqual([false]);
  });

  it('an RPC failure turns the mark off for now and is not remembered: the next call reads again', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const other = restart(test);
    other.chain.receiptOf.mockRejectedValueOnce(new Error('rpc down'));
    expect(marks((await get(other, qid)).body)).toEqual([false]);
    expect(marks((await get(other, qid)).body)).toEqual([true]);
  });

  it('a PAID row closed from the chain status alone (no settle_tx) is verified once the indexed log names the tx', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const settleTx = String(rowOf(test, qid)?.settle_tx);
    // What syncFromChain leaves behind: the stage, but not the tx that did it.
    test.store.prepare('UPDATE questions SET settle_tx = NULL WHERE qid = ?').run(qid);
    const other = restart(test);

    expect(marks((await get(other, qid)).body)).toEqual([false]); // no tx to read a receipt of yet
    await other.indexer.sweep(); // the Paid log gives the hash; the receipt is then read over RPC
    const read = await get(other, qid);
    expect(read.body.data.tx.settle).toBe(settleTx);
    expect(marks(read.body)).toEqual([true]);
  });

  it('a refunded question never shows the mark, although its answer is still returned (Q-04)', async () => {
    const llm = createFakeLlm();
    llm.state.answer = () => JSON.stringify({ noBasis: false, answer: 'x', citations: [] });
    const test = createTestApp({ llm });
    const { response, qid } = await ask(test);
    expect(response.body.data.status).toBe('REFUNDED');
    const read = await get(test, qid);
    expect(read.body.data).toMatchObject({ status: 'REFUNDED', reason: 'NO_CITATION' });
    expect(read.body.data.citations ?? []).toEqual([]);
  });
});

describe('AP-07-AC03 nothing is shown as paid, refunded or verified before the chain says so', () => {
  const seedAnswering = (test: TestApp, qid: Hex) => {
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
    transitionStage(test.store, qid, 'QUOTED', 'ANSWERING', T0, { payer: '0x'.padEnd(42, '1') });
  };
  const QID = `0x${'cd'.repeat(32)}` as Hex;

  it('a question still being answered is PENDING with its stage, and has no mark', async () => {
    const test = createTestApp();
    seedAnswering(test, QID);
    const read = await get(test, QID);
    expect(read.body.data).toMatchObject({ qid: QID, stage: 'ANSWERING', status: 'PENDING' });
    expect(read.body.data.citations).toBeUndefined();
  });

  it('past the deadline and still open on-chain it is CLAIMABLE, with the deadline (AP-06-AC03)', async () => {
    const test = createTestApp();
    seedAnswering(test, QID);
    test.chain.plantDeposit(QID, 600);
    await test.indexer.sweep();
    const deadline = test.chain.block.time + 600;

    test.clock.now = T0 + 599_000;
    expect((await get(test, QID)).body.data).toMatchObject({ status: 'PENDING', deadline });
    test.clock.now = deadline * 1000 + 1;
    expect((await get(test, QID)).body.data).toMatchObject({ status: 'CLAIMABLE', deadline });
  });

  it('a quote that was never paid shows only qid, question and stage (api.md §4)', async () => {
    const test = createTestApp();
    const quote = await test.api.post('/api/ask').send({ question: QUESTION });
    const qid = quote.body.accepts[0].extra.qid as string;
    const read = await get(test, qid);
    expect(read.body.data).toEqual({
      qid,
      question: QUESTION,
      stage: 'QUOTED',
      answerHash: null,
      citationsHash: null,
      createdAt: T0,
    });
  });

  it('an unknown or malformed qid is QUESTION_NOT_FOUND', async () => {
    const test = createTestApp();
    for (const qid of [`0x${'ee'.repeat(32)}`, 'not-a-qid', '0x12']) {
      const read = await get(test, qid);
      expect(read.status).toBe(404);
      expect(read.body.error.code).toBe('QUESTION_NOT_FOUND');
    }
  });

  it('accepts an upper-case qid', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const read = await get(test, `0x${qid.slice(2).toUpperCase()}`);
    expect(read.status).toBe(200);
    expect(read.body.data.qid).toBe(qid);
  });
});

describe('AP-08-AC02 where the database and the chain disagree, the chain wins', () => {
  const claimed = async () => {
    const test = createTestApp();
    const qid = `0x${'ab'.repeat(32)}` as Hex;
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
    transitionStage(test.store, qid, 'QUOTED', 'ANSWERING', T0);
    test.chain.plantDeposit(qid);
    const claimTx = test.chain.claimRefund(qid); // the payer took the money back; the server was away
    return { test, qid, claimTx };
  };

  it('a question the payer claimed shows REFUNDED / TIMEOUT with the claim tx once indexed', async () => {
    const { test, qid, claimTx } = await claimed();
    await test.indexer.sweep();
    const read = await get(test, qid);
    expect(read.body.data).toMatchObject({
      status: 'REFUNDED',
      stage: 'REFUNDED',
      reason: 'TIMEOUT',
      tx: { settle: claimTx },
    });
    expect(rowOf(test, qid)).toMatchObject({
      stage: 'REFUNDED',
      reason: 'TIMEOUT',
      settle_tx: claimTx,
    });
  });

  it('a row that recovery closed from the chain STATUS gets its reason and tx from the log (§5.6)', async () => {
    const { test, qid, claimTx } = await claimed();
    await test.recovery.startup(); // sees status Refunded, but no receipt of ours says why
    expect(rowOf(test, qid)).toMatchObject({ stage: 'REFUNDED', reason: null, settle_tx: null });
    await test.indexer.sweep();
    expect(rowOf(test, qid)).toMatchObject({
      stage: 'REFUNDED',
      reason: 'TIMEOUT',
      settle_tx: claimTx,
    });
  });

  it('a row edited to say PAID cannot override a Refunded the chain recorded', async () => {
    const { test, qid } = await claimed();
    await test.indexer.sweep();
    setColumn(test, qid, 'stage', 'PAID');
    const read = await get(test, qid);
    expect(read.body.data).toMatchObject({
      status: 'REFUNDED',
      stage: 'REFUNDED',
      reason: 'TIMEOUT',
    });
    expect(read.body.data.citations ?? []).toEqual([]);
  });

  it('the amount is the one the chain recorded, not the one in the row', async () => {
    const { test, qid } = await claimed();
    test.store.prepare('UPDATE questions SET price = ? WHERE qid = ?').run('999999999', qid);
    await test.indexer.sweep();
    expect((await get(test, qid)).body.data.amount).toBe(PRICE.toString());
  });
});

describe('the corpus text on a card comes from the corpus, not the database', () => {
  it('shows the real Khoản text for the cited Điều and Khoản', async () => {
    const test = createTestApp();
    const { qid } = await ask(test);
    const read = await get(test, qid);
    expect(read.body.data.citations[0].text).toBe(corpus.find(25, 2)?.text);
  });
});
