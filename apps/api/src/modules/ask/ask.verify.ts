// The server's own answer to "is the card I show what the checker signed?" (system-design §7, P2,
// Q-13). It decides the ✓ on a citation card, so it trusts nothing that lives in the database:
//
//  - the Paid event comes from the settle tx's RECEIPT, read over RPC, and only counts when the log
//    was emitted by this escrow for this qid (decoded in payment.chain). Not from chain_events,
//    which sits in the same file as the content being checked.
//  - the hashes are RECOMPUTED from what the page would show: the answer text, and each quote
//    hashed again (the stored quoteHash is not read).
//
// What is cached is the event, never the verdict: the row is compared again on every call, so a
// database edited after the first read turns the mark off.
import type { Hex } from 'viem';
import { citationsHash, hashText, type Citation } from '@askpay/shared/leaf';
import type { Logger } from '../../shared/logger.js';
import type { CorpusService } from '../corpus/corpus.service.js';
import { readReceipt, type PaymentChain, type SettleEvent } from '../payment/payment.service.js';
import type { QuestionRow } from './ask.repository.js';

type PaidEvent = Extract<SettleEvent, { name: 'Paid' }>;

export interface Verifier {
  // true only when the receipt of `settleTx` shows Paid for this qid AND the row's answer and
  // citations hash to what that event says. Never throws: no certainty means no mark.
  verify(row: QuestionRow, settleTx: Hex | undefined): Promise<boolean>;
  // A Paid event already read from a receipt in this process (see PipelineDeps.onPaid).
  remember(qid: Hex, settleTx: Hex, event: PaidEvent): void;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createVerifier(deps: {
  chain: PaymentChain;
  corpus: CorpusService;
  logger: Logger;
}): Verifier {
  const { chain, corpus, logger } = deps;
  // Receipts never change, so this is safe to keep. Keyed by qid AND tx: a row whose settle_tx was
  // edited to another transaction must not reuse the event of the right one.
  const events = new Map<string, PaidEvent>();
  const keyOf = (qid: Hex, settleTx: Hex) => `${qid.toLowerCase()}:${settleTx.toLowerCase()}`;

  async function paidEvent(qid: Hex, settleTx: Hex): Promise<PaidEvent | undefined> {
    const cached = events.get(keyOf(qid, settleTx));
    if (cached) return cached;
    let receipt;
    try {
      receipt = await readReceipt(chain, settleTx, qid);
    } catch {
      // The RPC failed: not certain, so no mark now, and nothing cached. The next call reads again.
      logger.warn({ qid }, 'receipt unreadable; verification skipped for now');
      return undefined;
    }
    if (!receipt?.success || receipt.event?.name !== 'Paid') return undefined;
    events.set(keyOf(qid, settleTx), receipt.event);
    return receipt.event;
  }

  // What the page shows, hashed again. The textHash must also be the real Khoản's: the card prints
  // the corpus text, so a stored hash of some other text would be a card about something else.
  function recompute(row: QuestionRow): { answerHash: Hex; citationsHash: Hex } | undefined {
    if (row.answer === null || row.citations === null) return undefined;
    const citations: Citation[] = [];
    for (const stored of row.citations) {
      const real = corpus.find(stored.dieu, stored.khoan);
      if (!real || !same(real.textHash, stored.textHash) || !same(stored.lawId, corpus.lawId)) {
        return undefined;
      }
      citations.push({
        lawId: stored.lawId,
        dieu: stored.dieu,
        khoan: stored.khoan,
        textHash: stored.textHash,
        quoteHash: hashText(stored.quote),
      });
    }
    return { answerHash: hashText(row.answer), citationsHash: citationsHash(citations) };
  }

  return {
    async verify(row, settleTx) {
      if (!settleTx) return false;
      const event = await paidEvent(row.qid, settleTx);
      if (!event) return false;
      const shown = recompute(row);
      if (
        shown &&
        same(shown.answerHash, event.answerHash) &&
        same(shown.citationsHash, event.citationsHash)
      ) {
        return true;
      }
      // P2: the chain wins. The stored content was edited, or written wrongly.
      logger.error(
        { qid: row.qid },
        'CITATIONS_MISMATCH: stored content differs from the Paid log',
      );
      return false;
    },
    remember(qid, settleTx, event) {
      events.set(keyOf(qid, settleTx), event);
    },
  };
}
