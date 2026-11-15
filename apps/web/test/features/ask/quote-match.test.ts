import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locateQuote } from '@/features/ask/quote-match';
// Test-only import: the web's src never imports the corpus package.
import { normalizeText } from '../../../../../packages/corpus/src/normalize';

const TEXT = 'Điều kiện sau đây:\na) Không quá 60 ngày đối với công việc\nb) Không quá 30 ngày.';

describe('locateQuote (design W3 §6.2)', () => {
  it('W3-E13: finds a quote that crosses a line break between points', () => {
    const quote = 'công việc b) Không quá 30 ngày.';
    const range = locateQuote(TEXT, quote);
    expect(range).toBeDefined();
    const found = TEXT.slice(range?.start, range?.end);
    expect(found).toBe('công việc\nb) Không quá 30 ngày.');
    expect(normalizeText(found)).toBe(quote);
  });

  it('W3-E13: an NFD text still matches, and the range indexes the NFC form', () => {
    const nfd = 'Điều kiện sau đây:\nb) Không quá 30 ngày'.normalize('NFD');
    const range = locateQuote(nfd, 'sau đây: b) Không');
    expect(range).toBeDefined();
    expect(nfd.normalize('NFC').slice(range?.start, range?.end)).toBe('sau đây:\nb) Không');
  });

  it('W3-E13: regex characters in the quote do not throw or over-match', () => {
    expect(locateQuote('giá (a.b) [x] + 1?', '(a.b) [x] + 1?')).toEqual({ start: 4, end: 18 });
    expect(locateQuote('axb', 'a.b')).toBeUndefined();
  });

  it('W3-E13: returns undefined when the quote is not there, or empty', () => {
    expect(locateQuote(TEXT, 'không có trong văn bản')).toBeUndefined();
    expect(locateQuote(TEXT, '   ')).toBeUndefined();
  });

  it('takes the first occurrence', () => {
    expect(locateQuote('ab ab', 'ab')).toEqual({ start: 0, end: 2 });
  });
});

type Khoan = { dieu: number; khoan: number; text: string };

// A small deterministic generator, so a failure names the same Khoản on every run.
function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('locateQuote on the real corpus', () => {
  const khoans = JSON.parse(
    readFileSync(resolve(process.cwd(), 'packages/corpus/data/blld-2019.khoan.json'), 'utf8'),
  ) as Khoan[];

  it('W3-E14: every substring the checker would accept (C2) is found, and matches exactly', () => {
    const random = lcg(20261115);
    let checked = 0;
    for (const { dieu, khoan, text } of khoans) {
      const normalized = normalizeText(text);
      if (normalized.length < 15) continue;
      for (let i = 0; i < 3; i += 1) {
        const length = 15 + Math.floor(random() * (normalized.length - 14));
        const start = Math.floor(random() * (normalized.length - length + 1));
        const quote = normalized.slice(start, start + length).trim();
        if (quote.length < 15) continue;
        // C2 accepts it: the normalised text includes the normalised quote.
        expect(normalized.includes(quote)).toBe(true);
        const range = locateQuote(text, quote);
        expect(range, `Điều ${dieu} Khoản ${khoan}: ${quote}`).toBeDefined();
        expect(normalizeText(text.normalize('NFC').slice(range?.start, range?.end))).toBe(quote);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
