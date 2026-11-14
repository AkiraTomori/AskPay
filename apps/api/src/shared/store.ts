// One SQLite connection for the whole process (node:sqlite, built into Node 24+). The chain is the
// source of truth for money; this file only keeps question text, answers and tx hashes for display
// (backend.md §4).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Store = DatabaseSync;

// Every column of the data model (system-design §7) exists from the start, so later slices
// (answer, checker, settle, indexer) need no migration of a database that may already hold data.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  qid               TEXT PRIMARY KEY,
  question          TEXT NOT NULL,
  question_hash     TEXT NOT NULL,
  price             TEXT NOT NULL,
  stage             TEXT NOT NULL,
  payer             TEXT,
  answer            TEXT,
  no_basis          INTEGER,
  citations_json    TEXT,
  answer_hash       TEXT,
  citations_hash    TEXT,
  checker_sig       TEXT,
  pending_tx        TEXT,
  pending_nonce     INTEGER,
  verdict_pass      INTEGER,
  reason            TEXT,
  deposit_tx        TEXT,
  settle_tx         TEXT,
  quote_expires_at  INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_stage ON questions (stage);

-- system-design §7: where the scan for Deposited logs stopped. One row. A lost database loses it too,
-- which is exactly right: the scan then starts over from the deployment block.
CREATE TABLE IF NOT EXISTS indexer_checkpoint (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER NOT NULL
);
`;

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const store = new DatabaseSync(path);
  store.exec('PRAGMA journal_mode = WAL;');
  store.exec(SCHEMA);
  return store;
}
