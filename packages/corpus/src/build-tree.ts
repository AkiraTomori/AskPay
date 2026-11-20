// Parsed Khoản -> textHash, StandardMerkleTree and root (AP-01-AC01, AP-01-AC02, AP-01-AC04).
//
// Pure: no file access. The CLI writes the outputs; tests call this directly. The leaf formula is
// not written here, it comes from @askpay/shared/leaf, the single TypeScript definition.
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import {
  BLLD_2019_LAW_ID,
  BLLD_2019_LAW_LABEL,
  LEAF_ENCODING,
  citationsHash,
  hashText,
  leafOf,
  leafValues,
  type Citation,
} from '@askpay/shared/leaf';
import type { Hex } from 'viem';
import { normalizeText } from './normalize.js';
import type { Khoan } from './parse.js';

export interface CorpusKhoan extends Khoan {
  // keccak256(utf8(text)); the text is already normalised, so this is what the leaf commits to.
  textHash: Hex;
}

export type LeafValue = [Hex, number, number, Hex];

export interface CorpusBuild {
  lawId: Hex;
  khoans: CorpusKhoan[];
  tree: StandardMerkleTree<LeafValue>;
  root: Hex;
}

export function buildCorpus(parsed: readonly Khoan[], lawId: Hex = BLLD_2019_LAW_ID): CorpusBuild {
  // Sorted so the output never depends on the order the parser emitted. (The tree also sorts its
  // leaves by hash, so the root is order-independent either way.)
  const sorted = [...parsed].sort((a, b) => a.dieu - b.dieu || a.khoan - b.khoan);

  const seen = new Set<string>();
  const khoans: CorpusKhoan[] = sorted.map((k) => {
    const key = `${k.dieu}.${k.khoan}`;
    if (seen.has(key)) throw new Error(`Duplicate Điều/Khoản in corpus: ${key}`);
    seen.add(key);
    // Normalise again even though the parser already did: AP-01-AC02 must hold for any caller, and
    // normalisation is idempotent.
    const text = normalizeText(k.text);
    if (text === '') throw new Error(`Empty text for Điều ${k.dieu} Khoản ${k.khoan}`);
    return { ...k, text, textHash: hashText(text) };
  });
  if (khoans.length === 0) throw new Error('Cannot build a Merkle tree from an empty corpus');

  const values = khoans.map((k) =>
    leafValues({ lawId, dieu: k.dieu, khoan: k.khoan, textHash: k.textHash }),
  );
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  return { lawId, khoans, tree, root: tree.root as Hex };
}

export function serializeCorpusKhoans(khoans: readonly CorpusKhoan[]): string {
  return `${JSON.stringify(khoans, null, 2)}\n`;
}

export function serializeTree(tree: StandardMerkleTree<LeafValue>): string {
  return `${JSON.stringify(tree.dump(), null, 2)}\n`;
}

export function serializeRoot(root: Hex): string {
  return `${root}\n`;
}

// The name /verify shows next to the root (W5 U-22). Same wording as the API's /corpus.
export const LAW_NAME = 'Bộ luật Lao động 2019 (45/2019/QH14)';

// What the /verify page imports at build time, so "the root in the repo" is never read from the
// server. Fixed key order, no date: a rebuild must be byte-identical (`git diff --exit-code`).
export function serializeMeta(build: CorpusBuild): string {
  const meta = {
    lawName: LAW_NAME,
    lawId: build.lawId,
    root: build.root,
    dieuCount: new Set(build.khoans.map((k) => k.dieu)).size,
    khoanCount: build.khoans.length,
  };
  return `${JSON.stringify(meta, null, 2)}\n`;
}

// Cross-language fixture for Foundry (K1/K2). It lists the inputs *and* the expected hashes so
// Solidity can recompute each one rather than only comparing hex: text -> textHash, leaf, proof
// against the root, quote -> quoteHash, and citationsHash.
export interface FoundryVectors {
  lawLabel: string;
  lawId: Hex;
  root: Hex;
  entries: {
    dieu: number;
    khoan: number;
    text: string;
    textHash: Hex;
    leaf: Hex;
    proof: Hex[];
    quote: string;
    quoteHash: Hex;
  }[];
  citationsCases: { name: string; citations: Citation[]; citationsHash: Hex }[];
}

// Chosen to cover the spec's required shapes with real corpus text: Khoản 0 as a whole Điều and as
// a lead-in before Khoản 1, and accented Vietnamese throughout.
const VECTOR_KHOANS: readonly (readonly [number, number])[] = [
  [1, 0],
  [3, 0],
  [3, 1],
  [35, 1],
  [219, 1],
];

const QUOTE_CODE_POINTS = 60;

export function buildFoundryVectors(build: CorpusBuild): FoundryVectors {
  const entries = VECTOR_KHOANS.map(([dieu, khoan]) => {
    const k = build.khoans.find((x) => x.dieu === dieu && x.khoan === khoan);
    if (!k) throw new Error(`Fixture Khoản ${khoan} Điều ${dieu} is not in the corpus`);
    const value = leafValues({ lawId: build.lawId, dieu, khoan, textHash: k.textHash });
    const quote = normalizeText(Array.from(k.text).slice(0, QUOTE_CODE_POINTS).join(''));
    return {
      dieu,
      khoan,
      text: k.text,
      textHash: k.textHash,
      leaf: leafOf({ lawId: build.lawId, dieu, khoan, textHash: k.textHash }),
      proof: build.tree.getProof(value) as Hex[],
      quote,
      quoteHash: hashText(quote),
    };
  });

  const asCitation = (e: FoundryVectors['entries'][number]): Citation => ({
    lawId: build.lawId,
    dieu: e.dieu,
    khoan: e.khoan,
    textHash: e.textHash,
    quoteHash: e.quoteHash,
  });
  const five = entries.map(asCitation);
  const first = five[0];
  if (!first) throw new Error('Fixture needs at least one entry');
  const cases = [
    { name: 'empty', citations: [] as Citation[] },
    { name: 'one-citation-khoan0', citations: [first] },
    { name: 'five-citations', citations: five },
    { name: 'five-citations-reversed', citations: [...five].reverse() },
  ];

  return {
    lawLabel: BLLD_2019_LAW_LABEL,
    lawId: build.lawId,
    root: build.root,
    entries,
    citationsCases: cases.map((c) => ({ ...c, citationsHash: citationsHash(c.citations) })),
  };
}

export function serializeVectors(vectors: FoundryVectors): string {
  return `${JSON.stringify(vectors, null, 2)}\n`;
}
