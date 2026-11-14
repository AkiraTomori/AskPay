// SQLite access for questions (backend.md §2). No business rules here, only reads and writes.
import type { z } from 'zod';
import type { questionStageSchema } from '@askpay/shared/api';
import type { Store } from '../../shared/store.js';

export type Stage = z.infer<typeof questionStageSchema>;

export interface QuestionRow {
  qid: `0x${string}`;
  question: string;
  questionHash: `0x${string}`;
  price: bigint;
  stage: Stage;
  payer: `0x${string}` | null;
  depositTx: `0x${string}` | null;
  quoteExpiresAt: number; // unix ms
  createdAt: number; // unix ms
  updatedAt: number; // unix ms
}

interface RawRow {
  qid: string;
  question: string;
  question_hash: string;
  price: string;
  stage: string;
  payer: string | null;
  deposit_tx: string | null;
  quote_expires_at: number;
  created_at: number;
  updated_at: number;
}

function toRow(raw: RawRow): QuestionRow {
  return {
    qid: raw.qid as QuestionRow['qid'],
    question: raw.question,
    questionHash: raw.question_hash as QuestionRow['questionHash'],
    price: BigInt(raw.price),
    stage: raw.stage as Stage,
    payer: raw.payer as QuestionRow['payer'],
    depositTx: raw.deposit_tx as QuestionRow['depositTx'],
    quoteExpiresAt: raw.quote_expires_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function insertQuote(
  store: Store,
  row: Pick<QuestionRow, 'qid' | 'question' | 'questionHash' | 'price' | 'quoteExpiresAt'>,
  now: number,
): void {
  store
    .prepare(
      `INSERT INTO questions (qid, question, question_hash, price, stage, quote_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'QUOTED', ?, ?, ?)`,
    )
    .run(
      row.qid,
      row.question,
      row.questionHash,
      row.price.toString(),
      row.quoteExpiresAt,
      now,
      now,
    );
}

export function findQuestion(store: Store, qid: string): QuestionRow | undefined {
  const raw = store.prepare('SELECT * FROM questions WHERE qid = ?').get(qid) as RawRow | undefined;
  return raw ? toRow(raw) : undefined;
}

// Moves a question from `from` to `to` only if it is still in `from`. Returns whether this call won.
// One statement, so two requests with the same signature cannot both pass (system-design §5.6 A).
export function transitionStage(
  store: Store,
  qid: string,
  from: Stage,
  to: Stage,
  now: number,
  fields: { payer?: string; depositTx?: string } = {},
): boolean {
  const result = store
    .prepare(
      `UPDATE questions
          SET stage = ?, updated_at = ?,
              payer = COALESCE(?, payer), deposit_tx = COALESCE(?, deposit_tx)
        WHERE qid = ? AND stage = ?`,
    )
    .run(to, now, fields.payer ?? null, fields.depositTx ?? null, qid, from);
  return Number(result.changes) === 1;
}
