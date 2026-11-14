// The one TypeScript implementation of the Merkle leaf and of citationsHash (system-design §6,
// contracts.md §4.3-4.4). packages/corpus and apps/api both call this; Solidity's `leafOf` and
// `citationsHashOf` must produce the same bytes (cross-checked by fixtures, see K1).
//
// Every string passed in here must already be normalised with `normalizeText` from
// @askpay/corpus. That function is not duplicated in this package on purpose: there is exactly one
// definition of "normalised text", and shared must not depend on corpus.
import { encodeAbiParameters, keccak256, toBytes, type Hex } from 'viem';

// The human-readable id from system-design §6. Kept next to its hash so the fixture can prove
// the two agree.
export const BLLD_2019_LAW_LABEL = 'VN-45/2019/QH14';
export const BLLD_2019_LAW_ID: Hex = keccak256(toBytes(BLLD_2019_LAW_LABEL));

// Value types of a StandardMerkleTree leaf. `quoteHash` is deliberately absent (contracts §4.3):
// the tree describes the corpus, while quotes change with every answer.
export const LEAF_ENCODING = ['bytes32', 'uint16', 'uint16', 'bytes32'] as const;

const UINT16_MAX = 0xffff;

export interface LeafInput {
  lawId: Hex;
  dieu: number;
  // 0 for text that belongs to the Điều as a whole.
  khoan: number;
  textHash: Hex;
}

// Mirrors Solidity `struct Citation` field for field and in the same order.
export interface Citation extends LeafInput {
  quoteHash: Hex;
}

// keccak256 of the UTF-8 bytes. Used for textHash (Khoản text) and quoteHash (quote).
export function hashText(normalizedText: string): Hex {
  return keccak256(toBytes(normalizedText));
}

function assertUint16(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) {
    throw new RangeError(`${name} must be an integer in 0..${UINT16_MAX}, got ${value}`);
  }
}

// The tuple StandardMerkleTree.of() expects, in LEAF_ENCODING order.
export function leafValues(input: LeafInput): [Hex, number, number, Hex] {
  assertUint16('dieu', input.dieu);
  assertUint16('khoan', input.khoan);
  return [input.lawId, input.dieu, input.khoan, input.textHash];
}

// keccak256(keccak256(abi.encode(lawId, dieu, khoan, textHash))). The inner hash is what stops a
// 64-byte inner node from being passed off as a leaf (second preimage).
export function leafOf(input: LeafInput): Hex {
  const encoded = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'bytes32' }],
    leafValues(input),
  );
  return keccak256(keccak256(encoded));
}

// keccak256(abi.encode(Citation[])): a single dynamic array, so the encoding starts with the
// 0x20 offset word. Order is significant: the same citations in another order hash differently.
export function citationsHash(citations: readonly Citation[]): Hex {
  for (const c of citations) {
    assertUint16('dieu', c.dieu);
    assertUint16('khoan', c.khoan);
  }
  const encoded = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'lawId', type: 'bytes32' },
          { name: 'dieu', type: 'uint16' },
          { name: 'khoan', type: 'uint16' },
          { name: 'textHash', type: 'bytes32' },
          { name: 'quoteHash', type: 'bytes32' },
        ],
      },
    ],
    [
      citations.map((c) => ({
        lawId: c.lawId,
        dieu: c.dieu,
        khoan: c.khoan,
        textHash: c.textHash,
        quoteHash: c.quoteHash,
      })),
    ],
  );
  return keccak256(encoded);
}
