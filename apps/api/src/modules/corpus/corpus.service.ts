// The law corpus as the API sees it: the Khoản to search, their text, and the Merkle proofs that
// settle needs. The tree is rebuilt from the generated file at startup (never hand-edited,
// AGENTS.md), and the server checks its root against the one registered on-chain before it takes
// any money.
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { buildCorpus, type CorpusBuild } from '@askpay/corpus/build-tree';
import type { Khoan } from '@askpay/corpus/parse';
import { leafValues } from '@askpay/shared/leaf';
import type { RetrievalDoc } from '../retrieval/retrieval.service.js';

export interface CorpusKhoanView {
  dieu: number;
  khoan: number;
  dieuTitle: string;
  text: string;
  textHash: Hex;
}

export interface CorpusService {
  readonly lawId: Hex;
  readonly root: Hex;
  // For retrieval (A1) and for the checker's quote match (C2).
  docs(): RetrievalDoc[];
  find(dieu: number, khoan: number): CorpusKhoanView | undefined;
  // Merkle proof of the REAL leaf. The demo's fake citation (§5.5) swaps the textHash it sends but
  // keeps this proof, so the chain finds the proof does not match.
  proofOf(dieu: number, khoan: number): Hex[];
}

export function createCorpus(parsed: readonly Khoan[]): CorpusService {
  const build: CorpusBuild = buildCorpus(parsed);
  const byKey = new Map(build.khoans.map((k) => [`${k.dieu}.${k.khoan}`, k] as const));

  return {
    lawId: build.lawId,
    root: build.root,
    docs: () =>
      build.khoans.map(({ dieu, khoan, dieuTitle, text }) => ({ dieu, khoan, dieuTitle, text })),
    find(dieu, khoan) {
      const found = byKey.get(`${dieu}.${khoan}`);
      return found
        ? {
            dieu: found.dieu,
            khoan: found.khoan,
            dieuTitle: found.dieuTitle,
            text: found.text,
            textHash: found.textHash,
          }
        : undefined;
    },
    proofOf(dieu, khoan) {
      const found = byKey.get(`${dieu}.${khoan}`);
      if (!found) throw new Error(`Điều ${dieu} Khoản ${khoan} is not in the corpus`);
      return build.tree.getProof(
        leafValues({ lawId: build.lawId, dieu, khoan, textHash: found.textHash }),
      ) as Hex[];
    },
  };
}

// The generated file lists every Khoản; extra fields (textHash) are recomputed, not trusted.
export function loadCorpus(path: string): CorpusService {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Khoan[];
  return createCorpus(
    raw.map(({ dieu, khoan, dieuTitle, chuong, text }) => ({
      dieu,
      khoan,
      dieuTitle,
      chuong,
      text,
    })),
  );
}

// packages/corpus/data/blld-2019.khoan.json, found from this file whether it runs from src or dist.
export const DEFAULT_CORPUS_PATH = new URL(
  '../../../../../packages/corpus/data/blld-2019.khoan.json',
  import.meta.url,
).pathname;
