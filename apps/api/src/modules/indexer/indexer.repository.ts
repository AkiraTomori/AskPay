// SQLite access for chain_events and the index checkpoint (backend.md §2). No rules here.
import type { Hex } from 'viem';
import type { Store } from '../../shared/store.js';
import type { ChainEvent } from '../payment/payment.service.js';

export type StoredEvent = ChainEvent;

interface RawEvent {
  tx_hash: string;
  log_index: number;
  block_number: number;
  name: string;
  qid: string | null;
  args_json: string;
}

const toEvent = (raw: RawEvent): StoredEvent => ({
  txHash: raw.tx_hash as Hex,
  logIndex: raw.log_index,
  blockNumber: raw.block_number,
  name: raw.name as StoredEvent['name'],
  qid: raw.qid as Hex | null,
  args: JSON.parse(raw.args_json) as Record<string, string>,
});

// Idempotent on (tx_hash, log_index): a range read twice, after a failure part-way, stores once.
// One transaction, so a range is never half in the table.
export function insertEvents(store: Store, events: readonly ChainEvent[]): void {
  if (events.length === 0) return;
  const insert = store.prepare(
    `INSERT OR IGNORE INTO chain_events (tx_hash, log_index, block_number, name, qid, args_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  store.exec('BEGIN');
  try {
    for (const event of events) {
      insert.run(
        event.txHash,
        event.logIndex,
        event.blockNumber,
        event.name,
        event.qid,
        JSON.stringify(event.args),
      );
    }
    store.exec('COMMIT');
  } catch (error) {
    store.exec('ROLLBACK');
    throw error;
  }
}

export function eventsOfQids(store: Store, qids: readonly Hex[]): StoredEvent[] {
  if (qids.length === 0) return [];
  const marks = qids.map(() => '?').join(', ');
  const raws = store
    .prepare(`SELECT * FROM chain_events WHERE qid IN (${marks}) ORDER BY block_number, log_index`)
    .all(...qids) as unknown as RawEvent[];
  return raws.map(toEvent);
}

export function eventsNamed(store: Store, names: readonly StoredEvent['name'][]): StoredEvent[] {
  const marks = names.map(() => '?').join(', ');
  const raws = store
    .prepare(`SELECT * FROM chain_events WHERE name IN (${marks}) ORDER BY block_number, log_index`)
    .all(...names) as unknown as RawEvent[];
  return raws.map(toEvent);
}

export function readCheckpoint(store: Store): bigint | undefined {
  const row = store.prepare('SELECT last_block FROM event_index_checkpoint WHERE id = 1').get() as
    { last_block: number } | undefined;
  return row ? BigInt(row.last_block) : undefined;
}

export function writeCheckpoint(store: Store, block: bigint): void {
  store
    .prepare(
      `INSERT INTO event_index_checkpoint (id, last_block) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block`,
    )
    .run(Number(block));
}
