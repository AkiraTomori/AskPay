import { describe, expect, it } from 'vitest';
import { tokenize } from '../../../src/modules/retrieval/bm25.js';
import {
  RETRIEVAL_TOP_K,
  createRetrieval,
  type RetrievalDoc,
} from '../../../src/modules/retrieval/retrieval.service.js';

// SYNTHETIC fixture: invented sentences that only exercise ranking mechanics. It is not text of
// the Labor Code, and no test here says anything about what the real law contains. Measuring
// AP-04-AC02 on the real corpus waits for C1.
const docs: RetrievalDoc[] = [
  {
    dieu: 1,
    khoan: 1,
    dieuTitle: 'Thời gian thử việc',
    text: 'Người lao động thử việc không quá sáu mươi ngày theo thỏa thuận.',
  },
  {
    dieu: 2,
    khoan: 0,
    dieuTitle: 'Nghỉ hằng năm',
    text: 'Người lao động được nghỉ mười hai ngày làm việc mỗi năm.',
  },
  {
    dieu: 3,
    khoan: 1,
    dieuTitle: 'Làm thêm giờ',
    text: 'Số giờ làm thêm không quá bốn mươi tám giờ trong một tháng.',
  },
  {
    dieu: 4,
    khoan: 2,
    dieuTitle: 'Tiền lương',
    text: 'Người sử dụng lao động trả lương cho người làm việc vào ban đêm. Làm việc thêm vào ngày nghỉ hưởng thêm tiền, giờ nghỉ được tính riêng.',
  },
  {
    dieu: 5,
    khoan: 1,
    dieuTitle: 'Chấm dứt hợp đồng',
    text: 'Báo trước ba mươi ngày khi chấm dứt hợp đồng.',
  },
];

describe('tokenize', () => {
  it('emits syllables and in-clause bigrams, lowercased', () => {
    expect(tokenize('Làm thêm giờ')).toEqual(['làm', 'thêm', 'giờ', 'làm thêm', 'thêm giờ']);
  });

  it('gives decomposed (NFD) and composed (NFC) input the same tokens', () => {
    const nfc = 'Thử việc tối đa bao nhiêu ngày?'.normalize('NFC');
    expect(tokenize(nfc.normalize('NFD'))).toEqual(tokenize(nfc));
  });

  it('drops punctuation and does not form bigrams across it', () => {
    const tokens = tokenize('thử việc, nghỉ');
    expect(tokens).toEqual(expect.arrayContaining(['thử', 'việc', 'nghỉ', 'thử việc']));
    expect(tokens).not.toContain('việc nghỉ');
    expect(tokens.some((token) => token.includes(','))).toBe(false);
  });

  it('keeps digits and returns nothing for blank input', () => {
    expect(tokenize('60 ngày')).toEqual(['60', 'ngày', '60 ngày']);
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('?!...')).toEqual([]);
  });
});

describe('createRetrieval', () => {
  it('puts the matching Khoản first and labels candidates C1…Cn', () => {
    const retrieve = createRetrieval(docs);
    const result = retrieve('Thử việc tối đa bao nhiêu ngày?');
    expect(result[0]).toMatchObject({
      id: 'C1',
      dieu: 1,
      khoan: 1,
      dieuTitle: 'Thời gian thử việc',
    });
    expect(result[0]?.text).toContain('thử việc');
    expect(result.map((candidate) => candidate.id)).toEqual(
      result.map((_, index) => `C${index + 1}`),
    );
  });

  it('ranks the contiguous phrase above the same words scattered (bigram effect)', () => {
    const retrieve = createRetrieval(docs);
    const result = retrieve('làm thêm giờ');
    expect(result[0]?.dieu).toBe(3);
    expect(result.findIndex((c) => c.dieu === 3)).toBeLessThan(
      result.findIndex((c) => c.dieu === 4),
    );
  });

  it('weights the Điều title, so a title hit beats an equal body hit', () => {
    const retrieve = createRetrieval([
      { dieu: 10, khoan: 1, dieuTitle: 'Tiền thưởng', text: 'Quy định chung về nội dung khác.' },
      { dieu: 11, khoan: 1, dieuTitle: 'Nội dung khác', text: 'Quy định chung về tiền thưởng.' },
    ]);
    expect(retrieve('tiền thưởng').map((c) => c.dieu)).toEqual([10, 11]);
  });

  it('returns at most top-k (default 8) candidates', () => {
    const many: RetrievalDoc[] = Array.from({ length: 20 }, (_, index) => ({
      dieu: index + 1,
      khoan: 1,
      dieuTitle: 'Nghỉ việc',
      text: `Người lao động nghỉ việc số ${index}.`,
    }));
    expect(RETRIEVAL_TOP_K).toBe(8);
    expect(createRetrieval(many)('nghỉ việc')).toHaveLength(8);
    expect(createRetrieval(many, { topK: 3 })('nghỉ việc')).toHaveLength(3);
  });

  it('returns no candidates when nothing matches or the question is blank', () => {
    const retrieve = createRetrieval(docs);
    expect(retrieve('xử phạt vượt đèn đỏ xe máy')).toEqual([]);
    expect(retrieve('   ')).toEqual([]);
  });

  it('is deterministic and breaks score ties by Điều then Khoản', () => {
    const tied: RetrievalDoc[] = [
      { dieu: 7, khoan: 2, dieuTitle: 'Tiêu đề', text: 'lương tháng' },
      { dieu: 7, khoan: 1, dieuTitle: 'Tiêu đề', text: 'lương tháng' },
      { dieu: 3, khoan: 5, dieuTitle: 'Tiêu đề', text: 'lương tháng' },
    ];
    const first = createRetrieval(tied)('lương tháng');
    expect(first.map((c) => [c.dieu, c.khoan])).toEqual([
      [3, 5],
      [7, 1],
      [7, 2],
    ]);
    expect(createRetrieval([...tied].reverse())('lương tháng')).toEqual(first);
  });

  it('rejects two records for the same Điều/Khoản', () => {
    expect(() =>
      createRetrieval([
        { dieu: 1, khoan: 0, dieuTitle: 'A', text: 'x' },
        { dieu: 1, khoan: 0, dieuTitle: 'A', text: 'y' },
      ]),
    ).toThrow(/duplicate/i);
  });
});
