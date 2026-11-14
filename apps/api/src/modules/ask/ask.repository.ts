// SQLite access for questions (backend.md §2). No business rules here, only reads and writes.
import type { z } from 'zod';
import type { questionStageSchema } from '@askpay/shared/api';
import type { RefundReasonCode } from '@askpay/shared/errors';
import type { Store } from '../../shared/store.js';

export type Stage = z.infer<typeof questionStageSchema>;
type Hex = `0x${string}`;

// What is stored per citation, in the order sent to settle (system-design §7). `quote` is the
// normalised string; `textHash` is what was signed, which in the demo's fake case is not the real
// text's hash.
export interface StoredCitation {
  lawId: Hex;
  dieu: number;
  khoan: number;
  dieuTitle: string;
  quote: string;
  textHash: Hex;
  quoteHash: Hex;
  proof: Hex[];
}

export interface QuestionRow {
  qid: Hex;
  question: string;
  questionHash: Hex;
  price: bigint;
  stage: Stage;
  payer: Hex | null;
  answer: string | null;
  noBasis: boolean | null;
  citations: StoredCitation[] | null;
  answerHash: Hex | null;
  citationsHash: Hex | null;
  checkerSig: Hex | null;
  pendingTx: Hex | null;
  pendingNonce: number | null;
  verdictPass: boolean | null;
  reason: RefundReasonCode | null;
  depositTx: Hex | null;
  settleTx: Hex | null;
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
  answer: string | null;
  no_basis: number | null;
  citations_json: string | null;
  answer_hash: string | null;
  citations_hash: string | null;
  checker_sig: string | null;
  pending_tx: string | null;
  pending_nonce: number | null;
  verdict_pass: number | null;
  reason: string | null;
  deposit_tx: string | null;
  settle_tx: string | null;
  quote_expires_at: number;
  created_at: number;
  updated_at: number;
}

const bool = (value: number | null) => (value === null ? null : value === 1);

function toRow(raw: RawRow): QuestionRow {
  return {
    qid: raw.qid as Hex,
    question: raw.question,
    questionHash: raw.question_hash as Hex,
    price: BigInt(raw.price),
    stage: raw.stage as Stage,
    payer: raw.payer as Hex | null,
    answer: raw.answer,
    noBasis: bool(raw.no_basis),
    citations: raw.citations_json ? (JSON.parse(raw.citations_json) as StoredCitation[]) : null,
    answerHash: raw.answer_hash as Hex | null,
    citationsHash: raw.citations_hash as Hex | null,
    checkerSig: raw.checker_sig as Hex | null,
    pendingTx: raw.pending_tx as Hex | null,
    pendingNonce: raw.pending_nonce,
    verdictPass: bool(raw.verdict_pass),
    reason: raw.reason as RefundReasonCode | null,
    depositTx: raw.deposit_tx as Hex | null,
    settleTx: raw.settle_tx as Hex | null,
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

export function listByStages(store: Store, stages: readonly Stage[]): QuestionRow[] {
  const marks = stages.map(() => '?').join(', ');
  const raws = store
    .prepare(`SELECT * FROM questions WHERE stage IN (${marks}) ORDER BY created_at`)
    .all(...stages) as unknown as RawRow[];
  return raws.map(toRow);
}

// The columns a transition may set. `null` clears a column; an absent key leaves it alone.
export interface Patch {
  payer?: string;
  answer?: string;
  noBasis?: boolean;
  citations?: StoredCitation[];
  answerHash?: string;
  citationsHash?: string;
  checkerSig?: string;
  pendingTx?: string | null;
  pendingNonce?: number | null;
  verdictPass?: boolean;
  reason?: RefundReasonCode;
  depositTx?: string;
  settleTx?: string;
}

const COLUMN: Record<keyof Patch, string> = {
  payer: 'payer',
  answer: 'answer',
  noBasis: 'no_basis',
  citations: 'citations_json',
  answerHash: 'answer_hash',
  citationsHash: 'citations_hash',
  checkerSig: 'checker_sig',
  pendingTx: 'pending_tx',
  pendingNonce: 'pending_nonce',
  verdictPass: 'verdict_pass',
  reason: 'reason',
  depositTx: 'deposit_tx',
  settleTx: 'settle_tx',
};

const definedKeys = (patch: Patch) =>
  (Object.keys(patch) as (keyof Patch)[]).filter((key) => patch[key] !== undefined);

type SqlValue = string | number | null;
function toSql(value: unknown): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

// Moves a question from `from` to `to` only if it is still in `from`, and sets `patch` in the SAME
// statement. Returns whether this call won. One statement, so two requests with the same signature
// cannot both pass (system-design §5.6 A), and a tx hash is never recorded without its stage
// change (§5.6 C).
export function transitionStage(
  store: Store,
  qid: string,
  from: Stage | readonly Stage[],
  to: Stage,
  now: number,
  patch: Patch = {},
): boolean {
  const froms = typeof from === 'string' ? [from] : from;
  const keys = definedKeys(patch);
  const sets = keys.map((key) => `${COLUMN[key]} = ?`);
  const result = store
    .prepare(
      `UPDATE questions SET stage = ?, updated_at = ?${sets.map((set) => `, ${set}`).join('')}
        WHERE qid = ? AND stage IN (${froms.map(() => '?').join(', ')})`,
    )
    .run(to, now, ...keys.map((key) => toSql(patch[key])), qid, ...froms);
  return Number(result.changes) === 1;
}

// Sets columns without a stage change, for as long as the question is in one of `stages`.
export function patchQuestion(
  store: Store,
  qid: string,
  stages: readonly Stage[],
  now: number,
  patch: Patch,
): boolean {
  const keys = definedKeys(patch);
  const sets = keys.map((key) => `${COLUMN[key]} = ?`);
  const result = store
    .prepare(
      `UPDATE questions SET updated_at = ?${sets.map((set) => `, ${set}`).join('')}
        WHERE qid = ? AND stage IN (${stages.map(() => '?').join(', ')})`,
    )
    .run(now, ...keys.map((key) => toSql(patch[key])), qid, ...stages);
  return Number(result.changes) === 1;
}

// The last block whose Deposited logs have all been handled (system-design §7, indexer_checkpoint).
export function readCheckpoint(store: Store): bigint | undefined {
  const row = store.prepare('SELECT last_block FROM indexer_checkpoint WHERE id = 1').get() as
    { last_block: number } | undefined;
  return row ? BigInt(row.last_block) : undefined;
}

export function writeCheckpoint(store: Store, block: bigint): void {
  store
    .prepare(
      `INSERT INTO indexer_checkpoint (id, last_block) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block`,
    )
    .run(Number(block));
}
