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

-- A5's scan checkpoint. It only ever covered Deposited logs, so A6 does not resume from it: an index
-- that started at its block would miss every earlier Paid and Refunded. Kept so an existing database
-- is not altered; nothing reads it any more.
CREATE TABLE IF NOT EXISTS indexer_checkpoint (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER NOT NULL
);

-- system-design §7: every escrow event the indexer has read (T-09). Display and statistics only:
-- verifiedOnChain never trusts this table (Q-13), because it lives in the same file as the content
-- it would vouch for.
CREATE TABLE IF NOT EXISTS chain_events (
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  name         TEXT NOT NULL,
  qid          TEXT,
  args_json    TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_qid ON chain_events (qid);

-- The last block whose events are all in chain_events and all handled. One row. A lost database
-- loses it too, and the index then starts again from the lookback window.
CREATE TABLE IF NOT EXISTS event_index_checkpoint (
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
