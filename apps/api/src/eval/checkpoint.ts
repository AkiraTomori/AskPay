// The checkpoint of a run in progress (E1 design §5): questions already finished, kept so a run
// that stopped (Ctrl+C, quota) continues instead of paying for them twice. A file that is missing,
// torn or from a different run is the same as none.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { QuestionRun } from './score.js';

export interface Checkpoint {
  // What the results depend on. A different key means the stored runs mean something else.
  key: string;
  runs: Record<string, QuestionRun>;
}

export interface CheckpointStore {
  load(): Checkpoint | undefined;
  save(checkpoint: Checkpoint): void;
  clear(): void;
}

const runSchema = z.object({
  id: z.string(),
  outcome: z.enum([
    'passed',
    'rejected',
    'answer-failed',
    'no-basis',
    'no-citation',
    'checker-failed',
    'infra',
  ]),
  rejectedAt: z.enum(['C2', 'C3', 'C4']).optional(),
  cited: z.array(z.object({ dieu: z.number(), khoan: z.number() })),
  retrievalHit: z.boolean(),
});
const checkpointSchema = z.object({ key: z.string(), runs: z.record(z.string(), runSchema) });

// Written beside the target and renamed over it, so an interrupt never leaves half a file.
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function createFileCheckpoint(path: string): CheckpointStore {
  return {
    load() {
      try {
        const parsed = checkpointSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        return parsed.success ? (parsed.data as Checkpoint) : undefined;
      } catch {
        return undefined;
      }
    },
    save: (checkpoint) => writeJsonAtomic(path, checkpoint),
    clear: () => rmSync(path, { force: true }),
  };
}
