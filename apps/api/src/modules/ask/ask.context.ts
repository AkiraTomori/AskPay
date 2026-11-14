// What the ask module's parts (service, pipeline, recovery) share. Kept in one object so they all
// see the same clock, store and, above all, the same set of questions that live code is working on.
import type { Hex } from 'viem';
import type { Logger } from '../../shared/logger.js';
import type { Store } from '../../shared/store.js';
import type { PaymentChain } from '../payment/payment.service.js';

// A set with a count per qid: the deposit request hands a question to the pipeline, and each of the
// two must be able to let go without releasing the other's hold.
export interface Inflight {
  has(qid: Hex): boolean;
  add(qid: Hex): void;
  delete(qid: Hex): void;
}

export function createInflight(): Inflight {
  const counts = new Map<Hex, number>();
  return {
    has: (qid) => (counts.get(qid) ?? 0) > 0,
    add: (qid) => void counts.set(qid, (counts.get(qid) ?? 0) + 1),
    delete(qid) {
      const left = (counts.get(qid) ?? 0) - 1;
      if (left > 0) counts.set(qid, left);
      else counts.delete(qid);
    },
  };
}

export interface AskContext {
  store: Store;
  chain: PaymentChain;
  logger: Logger;
  now: () => number; // unix ms; injectable so tests control time
  // Questions a live code path is working on right now: a deposit request waiting for its tx, or
  // a pipeline running. Recovery must leave these alone, or it would refund an answer in progress.
  inflight: Inflight;
}
