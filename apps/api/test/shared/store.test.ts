import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/shared/store.js';
import {
  findQuestion,
  insertQuote,
  transitionStage,
} from '../../src/modules/ask/ask.repository.js';

const qid = `0x${'aa'.repeat(32)}` as const;
const questionHash = `0x${'bb'.repeat(32)}` as const;

describe('store and question repository', () => {
  it('creates the schema and round-trips a quote with a bigint price', () => {
    const store = openStore(':memory:');
    insertQuote(
      store,
      { qid, question: 'Thử việc?', questionHash, price: 50_000n, quoteExpiresAt: 2 },
      1,
    );
    expect(findQuestion(store, qid)).toMatchObject({
      qid,
      question: 'Thử việc?',
      price: 50_000n,
      stage: 'QUOTED',
      payer: null,
    });
  });

  it('only one caller wins a stage transition', () => {
    const store = openStore(':memory:');
    insertQuote(store, { qid, question: 'q', questionHash, price: 1n, quoteExpiresAt: 2 }, 1);
    expect(transitionStage(store, qid, 'QUOTED', 'DEPOSITING', 5)).toBe(true);
    expect(transitionStage(store, qid, 'QUOTED', 'DEPOSITING', 6)).toBe(false);
    expect(findQuestion(store, qid)?.updatedAt).toBe(5);
  });

  it('does not overwrite payer or deposit tx with a transition that omits them', () => {
    const store = openStore(':memory:');
    insertQuote(store, { qid, question: 'q', questionHash, price: 1n, quoteExpiresAt: 2 }, 1);
    transitionStage(store, qid, 'QUOTED', 'DEPOSITING', 2);
    transitionStage(store, qid, 'DEPOSITING', 'ANSWERING', 3, { payer: '0xp', depositTx: '0xt' });
    transitionStage(store, qid, 'ANSWERING', 'CHECKING', 4);
    expect(findQuestion(store, qid)).toMatchObject({
      payer: '0xp',
      depositTx: '0xt',
      stage: 'CHECKING',
    });
  });

  it('refuses a duplicate qid', () => {
    const store = openStore(':memory:');
    const row = { qid, question: 'q', questionHash, price: 1n, quoteExpiresAt: 2 };
    insertQuote(store, row, 1);
    expect(() => insertQuote(store, row, 1)).toThrow();
  });
});
