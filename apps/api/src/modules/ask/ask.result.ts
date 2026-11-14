// What an API caller may see of a question (api.md §3.2, §4). One mapping, used by POST /ask and
// by the 409 replay answer, so they cannot disagree.
import type { QuestionResult } from '@askpay/shared/api';
import type { CorpusService } from '../corpus/corpus.service.js';
import type { QuestionRow } from './ask.repository.js';

export function toQuestionResult(row: QuestionRow, corpus: CorpusService): QuestionResult {
  const started = row.stage !== 'QUOTED' && row.stage !== 'EXPIRED';
  const status =
    row.stage === 'PAID'
      ? 'PAID'
      : row.stage === 'REFUNDED'
        ? 'REFUNDED'
        : started
          ? 'PENDING'
          : undefined;
  const settle = row.settleTx ?? undefined;
  return {
    qid: row.qid,
    question: row.question,
    stage: row.stage,
    ...(status ? { status } : {}),
    ...(row.stage === 'REFUNDED' ? { reason: row.reason } : {}),
    ...(started ? { amount: row.price.toString() } : {}),
    ...(row.payer ? { payer: row.payer } : {}),
    ...(row.answer !== null ? { answer: row.answer } : {}),
    ...(row.noBasis !== null ? { noBasis: row.noBasis } : {}),
    ...(row.citations
      ? {
          citations: row.citations.map((citation) => ({
            lawId: citation.lawId,
            dieu: citation.dieu,
            khoan: citation.khoan,
            dieuTitle: citation.dieuTitle,
            quote: citation.quote,
            text: corpus.find(citation.dieu, citation.khoan)?.text ?? '',
            textHash: citation.textHash,
            quoteHash: citation.quoteHash,
            // Recomputed from the receipt read through RPC by the indexer slice (A6, T-13). Until
            // then no card claims on-chain verification (AP-07-AC03: never claim before proof).
            verifiedOnChain: false,
          })),
        }
      : {}),
    answerHash: row.answerHash,
    citationsHash: row.citationsHash,
    ...(row.depositTx || settle
      ? {
          tx: {
            ...(row.depositTx ? { deposit: row.depositTx } : {}),
            ...(settle ? { settle } : {}),
          },
        }
      : {}),
    createdAt: row.createdAt,
  };
}
