import { concatHex, encodeAbiParameters, keccak256, numberToHex, toBytes, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  BLLD_2019_LAW_ID,
  BLLD_2019_LAW_LABEL,
  citationsHash,
  hashText,
  leafOf,
  type Citation,
} from '../src/leaf.js';

const word = (n: number): Hex => numberToHex(n, { size: 32 });

const citation = (dieu: number, khoan: number, text: string, quote: string): Citation => ({
  lawId: BLLD_2019_LAW_ID,
  dieu,
  khoan,
  textHash: hashText(text),
  quoteHash: hashText(quote),
});

describe('lawId', () => {
  it('AP-01-AC04: is keccak256 of the label in system-design §6', () => {
    expect(BLLD_2019_LAW_LABEL).toBe('VN-45/2019/QH14');
    expect(BLLD_2019_LAW_ID).toBe(keccak256(toBytes('VN-45/2019/QH14')));
  });
});

describe('hashText', () => {
  it('hashes the UTF-8 bytes, so accented text differs from its ASCII fold', () => {
    expect(hashText('Điều')).toBe(
      keccak256(new Uint8Array([0xc4, 0x90, 0x69, 0xe1, 0xbb, 0x81, 0x75])),
    );
    expect(hashText('Điều')).not.toBe(hashText('Dieu'));
  });
});

describe('leafOf', () => {
  it('AP-01-AC01: equals keccak(keccak(abi.encode(...))) built from raw words', () => {
    const textHash = hashText('Nguyên văn Khoản');
    // Hand-assembled ABI encoding: four static 32-byte words, no helper that could share a bug.
    const manual = concatHex([BLLD_2019_LAW_ID, word(35), word(0), textHash]);
    expect(leafOf({ lawId: BLLD_2019_LAW_ID, dieu: 35, khoan: 0, textHash })).toBe(
      keccak256(keccak256(manual)),
    );
  });

  it('is not the single-hash value (second-preimage protection)', () => {
    const textHash = hashText('x');
    const single = keccak256(concatHex([BLLD_2019_LAW_ID, word(1), word(1), textHash]));
    expect(leafOf({ lawId: BLLD_2019_LAW_ID, dieu: 1, khoan: 1, textHash })).not.toBe(single);
  });

  it.each([-1, 65536, 1.5, Number.NaN])('rejects dieu/khoan %s (uint16)', (bad) => {
    const textHash = hashText('x');
    expect(() => leafOf({ lawId: BLLD_2019_LAW_ID, dieu: bad, khoan: 0, textHash })).toThrow(
      RangeError,
    );
    expect(() => leafOf({ lawId: BLLD_2019_LAW_ID, dieu: 1, khoan: bad, textHash })).toThrow(
      RangeError,
    );
  });

  it('accepts the uint16 bounds', () => {
    const textHash = hashText('x');
    expect(() =>
      leafOf({ lawId: BLLD_2019_LAW_ID, dieu: 0, khoan: 65535, textHash }),
    ).not.toThrow();
  });
});

describe('citationsHash', () => {
  const a = citation(3, 0, 'lead-in of Điều 3', 'lead-in');
  const b = citation(35, 1, 'Người lao động có quyền', 'có quyền');

  it('AP-04-AC05: matches a hand-assembled abi.encode(Citation[]) (offset, length, then 5 words per item)', () => {
    const manual = concatHex([
      word(0x20),
      word(2),
      ...[a, b].flatMap((c) => [c.lawId, word(c.dieu), word(c.khoan), c.textHash, c.quoteHash]),
    ]);
    expect(citationsHash([a, b])).toBe(keccak256(manual));
  });

  it('matches the encoding of the empty list (offset 0x20, length 0)', () => {
    expect(citationsHash([])).toBe(keccak256(concatHex([word(0x20), word(0)])));
  });

  it('order is significant', () => {
    expect(citationsHash([a, b])).not.toBe(citationsHash([b, a]));
  });

  it('changing only the quote changes the hash (quoteHash is committed, T-13)', () => {
    expect(citationsHash([a])).not.toBe(citationsHash([{ ...a, quoteHash: hashText('other') }]));
  });

  it('rejects a Điều that does not fit uint16 before encoding', () => {
    expect(() => citationsHash([{ ...a, dieu: 70000 }])).toThrow(RangeError);
  });

  it('rejects a hash that is not 32 bytes', () => {
    expect(() => citationsHash([{ ...a, quoteHash: '0x1234' }])).toThrow();
    // Sanity: the same input shape with viem directly would also be rejected, so this is not ours.
    expect(() => encodeAbiParameters([{ type: 'bytes32' }], ['0x1234'])).toThrow();
  });
});
