import { describe, expect, it } from 'vitest';
import { checkQuestion } from '@/features/ask/question';

describe('checkQuestion (same rules as askRequestSchema)', () => {
  it('AP-02-AC02: empty and whitespace-only are invalid', () => {
    expect(checkQuestion('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkQuestion('   \n ')).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('AP-02-AC02: 501 characters is too long, 500 is fine', () => {
    expect(checkQuestion('a'.repeat(501))).toMatchObject({
      ok: false,
      reason: 'tooLong',
      length: 501,
    });
    expect(checkQuestion('a'.repeat(500))).toMatchObject({ ok: true, length: 500 });
  });
  it('W2-E03 AP-03-AC04: counts and returns the NFC form, trimmed', () => {
    const decomposed = 'ệ'.normalize('NFD'); // 3 code units once decomposed
    const result = checkQuestion(`  ${decomposed.repeat(500)}  `);
    expect(result).toMatchObject({ ok: true, length: 500 });
    expect(result.ok && result.question).toBe('ệ'.normalize('NFC').repeat(500));
  });
});
