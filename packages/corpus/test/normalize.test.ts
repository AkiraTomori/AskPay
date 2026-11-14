import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/normalize.js';

describe('normalizeText', () => {
  it('AP-01-AC02: gives the same string for NFC and NFD spellings of the same words', () => {
    const nfc = 'Thời gian thử việc do hai bên thỏa thuận';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(normalizeText(nfd)).toBe(nfc);
  });

  it('AP-01-AC02: collapses spaces, newlines and no-break spaces to one space and trims', () => {
    expect(normalizeText('  a  b\n\n c\t d  ')).toBe('a b c d');
  });

  it('is idempotent', () => {
    const once = normalizeText('  Điều  25. \n Thử   việc ');
    expect(normalizeText(once)).toBe(once);
  });
});
