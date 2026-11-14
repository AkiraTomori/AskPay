import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BLLD_2019_LAW_ID, leafValues } from '@askpay/shared/leaf';
import { DEFAULT_CORPUS_PATH, loadCorpus } from '../../../src/modules/corpus/corpus.service.js';

const corpus = loadCorpus(DEFAULT_CORPUS_PATH);

describe('corpus service', () => {
  it('rebuilds exactly the root that is registered on-chain and stored in the repo', () => {
    const stored = readFileSync('packages/corpus/data/blld-2019.root.txt', 'utf8').trim();
    expect(corpus.root).toBe(stored);
    expect(corpus.lawId).toBe(BLLD_2019_LAW_ID);
  });

  it('gives a proof that verifies against the root for any Khoản, Khoản 0 included', () => {
    for (const [dieu, khoan] of [
      [1, 0],
      [25, 2],
      [219, 1],
    ] as const) {
      const found = corpus.find(dieu, khoan);
      if (!found) throw new Error(`missing ${dieu}.${khoan}`);
      const leaf = leafValues({ lawId: corpus.lawId, dieu, khoan, textHash: found.textHash });
      expect(
        StandardMerkleTree.verify(
          corpus.root,
          ['bytes32', 'uint16', 'uint16', 'bytes32'],
          leaf,
          corpus.proofOf(dieu, khoan),
        ),
      ).toBe(true);
    }
  });

  it('finds a Khoản by Điều and Khoản, and nothing for one that does not exist', () => {
    expect(corpus.find(25, 2)?.text).toContain('Không quá 60 ngày');
    expect(corpus.find(999, 1)).toBeUndefined();
    expect(() => corpus.proofOf(999, 1)).toThrow(/not in the corpus/);
  });

  it('lists every Khoản for retrieval', () => {
    expect(corpus.docs().length).toBeGreaterThan(500);
  });
});
