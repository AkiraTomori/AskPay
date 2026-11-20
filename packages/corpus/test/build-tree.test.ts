import { readFileSync } from 'node:fs';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BLLD_2019_LAW_ID, citationsHash, hashText, leafOf } from '@askpay/shared/leaf';
import { describe, expect, it } from 'vitest';
import {
  buildCorpus,
  buildFoundryVectors,
  serializeCorpusKhoans,
  serializeMeta,
  serializeRoot,
  serializeTree,
  serializeVectors,
  type CorpusKhoan,
  type FoundryVectors,
} from '../src/build-tree.js';
import { normalizeText } from '../src/normalize.js';
import { parseLaw, type Khoan } from '../src/parse.js';

const packageRoot = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, packageRoot), 'utf8');

const parsed = parseLaw(read('raw/blld-2019-goc.vbpl.html'));
const build = buildCorpus(parsed);

const khoan = (dieu: number, k: number, text: string): Khoan => ({
  dieu,
  khoan: k,
  dieuTitle: `Điều ${dieu}`,
  chuong: 'Chương I',
  text,
});

describe('reproducibility (AP-01-AC01)', () => {
  it('AP-01-AC01: two builds from the same input give the same root and byte-identical output', () => {
    const again = buildCorpus(parseLaw(read('raw/blld-2019-goc.vbpl.html')));
    expect(again.root).toBe(build.root);
    expect(serializeTree(again.tree)).toBe(serializeTree(build.tree));
    expect(serializeCorpusKhoans(again.khoans)).toBe(serializeCorpusKhoans(build.khoans));
  });

  it('AP-01-AC01: the root does not depend on the order the parser emitted Khoản', () => {
    expect(buildCorpus([...parsed].reverse()).root).toBe(build.root);
  });

  it('AP-01-AC01: committed khoan.json, tree.json, root.txt and Foundry vectors are exactly the build output (run `npm run corpus`)', () => {
    expect(read('data/blld-2019.khoan.json')).toBe(serializeCorpusKhoans(build.khoans));
    expect(read('data/blld-2019.tree.json')).toBe(serializeTree(build.tree));
    expect(read('data/blld-2019.root.txt')).toBe(serializeRoot(build.root));
    expect(read('data/blld-2019.meta.json')).toBe(serializeMeta(build));
    expect(read('data/blld-2019.foundry-vectors.json')).toBe(
      serializeVectors(buildFoundryVectors(build)),
    );
  });

  it('W5 U-22: meta.json carries the same root as root.txt and the real counts, no date', () => {
    const meta = JSON.parse(read('data/blld-2019.meta.json')) as Record<string, unknown>;
    expect(meta).toEqual({
      lawName: 'Bộ luật Lao động 2019 (45/2019/QH14)',
      lawId: BLLD_2019_LAW_ID,
      root: read('data/blld-2019.root.txt').trim(),
      dieuCount: new Set(build.khoans.map((k) => k.dieu)).size,
      khoanCount: build.khoans.length,
    });
    expect(Object.keys(meta)).toEqual(['lawName', 'lawId', 'root', 'dieuCount', 'khoanCount']);
  });

  it('covers every Khoản the parser found', () => {
    expect(build.khoans).toHaveLength(parsed.length);
    expect(new Set(build.khoans.map((k) => k.dieu)).size).toBe(220);
  });

  it('changing one word changes the root', () => {
    const edited = parsed.map((k, i) => (i === 100 ? { ...k, text: `${k.text} thêm` } : k));
    expect(buildCorpus(edited).root).not.toBe(build.root);
  });
});

describe('anyone can rebuild the root from the repo (AP-01-AC04)', () => {
  const committed = JSON.parse(read('data/blld-2019.khoan.json')) as CorpusKhoan[];

  it('AP-01-AC04: committed root.txt is rebuilt from khoan.json alone, without the raw HTML', () => {
    const rebuilt = buildCorpus(committed.map((k) => khoan(k.dieu, k.khoan, k.text)));
    expect(`${rebuilt.root}\n`).toBe(read('data/blld-2019.root.txt'));
  });

  it('AP-01-AC04: every stored textHash is keccak256 of its stored text', () => {
    for (const k of committed) expect(k.textHash).toBe(hashText(k.text));
  });

  it('AP-01-AC04: the dumped tree loads, verifies, and its root matches root.txt', () => {
    const loaded = StandardMerkleTree.load(JSON.parse(read('data/blld-2019.tree.json')));
    expect(`${loaded.root}\n`).toBe(read('data/blld-2019.root.txt'));
    expect(() => loaded.validate()).not.toThrow();
  });

  it('AP-01-AC04: every Khoản has a proof that verifies against the root', () => {
    const loaded = StandardMerkleTree.load<[string, number, number, string]>(
      JSON.parse(read('data/blld-2019.tree.json')),
    );
    for (const k of committed) {
      const value: [string, number, number, string] = [
        BLLD_2019_LAW_ID,
        k.dieu,
        k.khoan,
        k.textHash,
      ];
      expect(
        StandardMerkleTree.verify(
          loaded.root,
          ['bytes32', 'uint16', 'uint16', 'bytes32'],
          value,
          loaded.getProof(value),
        ),
      ).toBe(true);
    }
  });
});

describe('leaf formula agrees with the library (AP-01-AC01)', () => {
  it('AP-01-AC01: leafOf() equals the tree own leaf hash for every Khoản', () => {
    // StandardMerkleTree hashes leaves with its own encoder. This is the independent check that
    // packages/shared/leaf.ts has not drifted from it.
    for (const k of build.khoans) {
      const value: [string, number, number, string] = [
        BLLD_2019_LAW_ID,
        k.dieu,
        k.khoan,
        k.textHash,
      ];
      expect(
        leafOf({ lawId: BLLD_2019_LAW_ID, dieu: k.dieu, khoan: k.khoan, textHash: k.textHash }),
      ).toBe(build.tree.leafHash(value as never));
    }
  });
});

describe('normalisation before hashing (AP-01-AC02)', () => {
  const composed = 'Người lao động có quyền nghỉ';
  const decomposed = composed.normalize('NFD');

  it('the two spellings really differ as strings', () => {
    expect(decomposed).not.toBe(composed);
  });

  it('AP-01-AC02: NFC and NFD (with stray whitespace) give the same textHash, leaf and root', () => {
    const a = buildCorpus([khoan(1, 1, composed), khoan(1, 2, 'Khoản hai')]);
    const b = buildCorpus([khoan(1, 1, `  ${decomposed}\n`), khoan(1, 2, 'Khoản   hai')]);
    expect(b.khoans[0]?.textHash).toBe(a.khoans[0]?.textHash);
    expect(b.khoans[0]?.text).toBe(composed);
    expect(b.root).toBe(a.root);
  });

  it('AP-01-AC02: textHash is over normalised text, not the raw input', () => {
    const built = buildCorpus([khoan(2, 1, decomposed)]);
    expect(built.khoans[0]?.textHash).toBe(hashText(normalizeText(decomposed)));
    expect(built.khoans[0]?.textHash).not.toBe(hashText(decomposed));
  });
});

describe('input validation', () => {
  it('rejects a duplicate Điều/Khoản instead of silently shadowing one', () => {
    expect(() => buildCorpus([khoan(1, 1, 'a'), khoan(1, 1, 'b')])).toThrow(/Duplicate/u);
  });

  it('rejects text that is empty after normalisation', () => {
    expect(() => buildCorpus([khoan(1, 1, ' \n ')])).toThrow(/Empty text/u);
  });

  it('rejects an empty corpus', () => {
    expect(() => buildCorpus([])).toThrow(/empty corpus/u);
  });

  it('rejects a Điều that does not fit uint16', () => {
    expect(() => buildCorpus([khoan(70000, 1, 'a')])).toThrow(RangeError);
  });
});

describe('Foundry vectors (AP-01-AC01, AP-01-AC04)', () => {
  const vectors = JSON.parse(read('data/blld-2019.foundry-vectors.json')) as FoundryVectors;

  it('AP-01-AC01: covers a Khoản 0, accented text, and 1 and 5 citations', () => {
    expect(vectors.entries.some((e) => e.khoan === 0)).toBe(true);
    expect(vectors.entries.some((e) => /[ạ-ỹ]/u.test(e.text))).toBe(true);
    const sizes = vectors.citationsCases.map((c) => c.citations.length);
    expect(sizes).toEqual(expect.arrayContaining([1, 5]));
  });

  it('AP-01-AC04: root equals root.txt and each proof verifies for its leaf', () => {
    expect(`${vectors.root}\n`).toBe(read('data/blld-2019.root.txt'));
    for (const e of vectors.entries) {
      expect(
        StandardMerkleTree.verify(
          vectors.root,
          ['bytes32', 'uint16', 'uint16', 'bytes32'],
          [vectors.lawId, e.dieu, e.khoan, e.textHash],
          e.proof,
        ),
      ).toBe(true);
    }
  });

  it('recomputes every hash from the raw strings, as Solidity will', () => {
    for (const e of vectors.entries) {
      expect(hashText(e.text)).toBe(e.textHash);
      expect(hashText(e.quote)).toBe(e.quoteHash);
      expect(e.text).toContain(e.quote);
      expect(e.quote.length).toBeGreaterThanOrEqual(15);
      expect(
        leafOf({ lawId: vectors.lawId, dieu: e.dieu, khoan: e.khoan, textHash: e.textHash }),
      ).toBe(e.leaf);
    }
    for (const c of vectors.citationsCases)
      expect(citationsHash(c.citations)).toBe(c.citationsHash);
  });

  it('the reversed five-citation case has a different hash than the original order', () => {
    const byName = new Map(vectors.citationsCases.map((c) => [c.name, c.citationsHash]));
    expect(byName.get('five-citations')).not.toBe(byName.get('five-citations-reversed'));
  });
});
