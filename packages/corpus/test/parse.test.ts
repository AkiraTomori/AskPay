import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLaw, serializeKhoans, type Khoan } from '../src/parse.js';

const packageRoot = new URL('../', import.meta.url);
const rawHtml = readFileSync(new URL('raw/blld-2019-goc.vbpl.html', packageRoot), 'utf8');
const committedJson = readFileSync(new URL('data/blld-2019.khoan.json', packageRoot), 'utf8');
const sourceNote = readFileSync(new URL('raw/SOURCE.md', packageRoot), 'utf8');

const khoans = parseLaw(rawHtml);
const find = (dieu: number, khoan: number): Khoan => {
  const found = khoans.find((k) => k.dieu === dieu && k.khoan === khoan);
  if (!found) throw new Error(`Khoản ${khoan} Điều ${dieu} missing`);
  return found;
};
const khoansOf = (dieu: number): number[] =>
  khoans.filter((k) => k.dieu === dieu).map((k) => k.khoan);

const doc = (...paragraphs: string[]): string =>
  paragraphs.map((p) => `<p class="MsoNormal">${p}</p>`).join('\n') +
  '<p>Bộ luật này được Quốc hội nước Việt Nam thông qua ngày 20 tháng 11 năm 2019./.</p>';

describe('raw source and reproducibility (AP-01-AC01)', () => {
  it('AP-01-AC01: raw file is the one pinned in SOURCE.md', () => {
    const pinned = /SHA-256 \| `([0-9a-f]{64})`/u.exec(sourceNote)?.[1];
    expect(createHash('sha256').update(rawHtml).digest('hex')).toBe(pinned);
  });

  it('AP-01-AC01: parsing twice gives byte-identical output', () => {
    expect(serializeKhoans(parseLaw(rawHtml))).toBe(serializeKhoans(khoans));
  });

  // `npm run corpus` adds textHash on top of the parser output (build-tree.ts, C2). Everything else
  // must be exactly what the parser produces; the full file is pinned in build-tree.test.ts.
  it('AP-01-AC01: data/blld-2019.khoan.json holds exactly the parser output plus textHash (run `npm run corpus`)', () => {
    const withoutHash = (JSON.parse(committedJson) as (Khoan & { textHash: string })[]).map(
      (k) => ({
        dieu: k.dieu,
        dieuTitle: k.dieuTitle,
        chuong: k.chuong,
        khoan: k.khoan,
        text: k.text,
      }),
    );
    expect(serializeKhoans(withoutHash)).toBe(serializeKhoans(khoans));
  });
});

describe('corpus structure (AP-01-AC03)', () => {
  it('AP-01-AC03: has 220 Điều numbered 1 to 220 without gaps', () => {
    const dieus = [...new Set(khoans.map((k) => k.dieu))];
    expect(dieus).toEqual(Array.from({ length: 220 }, (_, i) => i + 1));
  });

  it('AP-01-AC03: Khoản in each Điều are in order, 0 first, then 1..n without gaps', () => {
    for (let dieu = 1; dieu <= 220; dieu += 1) {
      const numbers = khoansOf(dieu);
      const first = numbers[0] === 0 ? 0 : 1;
      expect(numbers, `Điều ${dieu}`).toEqual(
        Array.from({ length: numbers.length }, (_, i) => i + first),
      );
    }
  });

  it('AP-01-AC03: 37 Điều have no Khoản and 12 have a lead-in before Khoản 1 (SOURCE.md pre-check)', () => {
    const noKhoan = Array.from({ length: 220 }, (_, i) => i + 1).filter(
      (d) => khoansOf(d).join() === '0',
    );
    const leadIn = Array.from({ length: 220 }, (_, i) => i + 1).filter((d) => {
      const numbers = khoansOf(d);
      return numbers.length > 1 && numbers[0] === 0;
    });
    expect(noKhoan).toHaveLength(37);
    expect(leadIn).toEqual([3, 25, 56, 58, 67, 99, 108, 120, 125, 187, 199, 205]);
  });

  it('AP-01-AC03: Điều 1 and 2 match the law', () => {
    expect(find(1, 0)).toMatchObject({
      dieuTitle: 'Phạm vi điều chỉnh',
      chuong: 'Chương I. NHỮNG QUY ĐỊNH CHUNG',
    });
    expect(find(1, 0).text).toMatch(/^Bộ luật Lao động quy định tiêu chuẩn lao động;/u);
    expect(khoansOf(2)).toEqual([1, 2, 3, 4]);
    expect(find(2, 2).text).toBe('Người sử dụng lao động.');
  });

  it('AP-01-AC03: Điều 25 keeps its lead-in as Khoản 0 and the four limits as Khoản 1-4', () => {
    expect(khoansOf(25)).toEqual([0, 1, 2, 3, 4]);
    expect(find(25, 0).text).toContain('chỉ được thử việc một lần đối với một công việc');
    expect(find(25, 2).text).toMatch(
      /^Không quá 60 ngày đối với công việc có chức danh nghề nghiệp/u,
    );
    expect(find(25, 2)).toMatchObject({
      dieuTitle: 'Thời gian thử việc',
      chuong: 'Chương III. HỢP ĐỒNG LAO ĐỘNG',
    });
  });

  it('AP-01-AC03: continuation paragraphs stay inside their Khoản (Điều 3 Khoản 1)', () => {
    expect(find(3, 1).text).toMatch(
      /giám sát của người sử dụng lao động\. Độ tuổi lao động tối thiểu/u,
    );
  });

  it('AP-01-AC03: Điều 219 quotes other laws inside Khoản 1 and 2 without splitting on their numbering', () => {
    expect(khoansOf(219)).toEqual([1, 2]);
    expect(find(219, 1).text).toContain('“Điều 54. Điều kiện hưởng lương hưu');
    expect(find(219, 1).text).toMatch(/Đủ 20 năm đóng bảo hiểm xã hội trở lên\.”\.$/u);
    expect(find(219, 2).text).toContain('1c. Tranh chấp lao động tập thể');
  });

  it('AP-01-AC03: Điều 220 ends at the promulgation clause, not at the signatures', () => {
    expect(khoansOf(220)).toEqual([1, 2, 3]);
    expect(find(220, 1).text).toContain('Bộ luật Lao động số 10/2012/QH13 hết hiệu lực');
    const everything = khoans.map((k) => k.text).join('\n');
    for (const leaked of ['CHỦ TỊCH QUỐC HỘI', 'SAO Y BẢN CHÍNH', 'thông qua ngày 20 tháng 11']) {
      expect(everything).not.toContain(leaked);
    }
  });

  it('AP-01-AC03: chapter and section headings do not leak into the previous Khoản', () => {
    expect(khoans.filter((k) => /(?:Mục \d+\.|Chương [IVXLC]+) \p{Lu}{3}/u.test(k.text))).toEqual(
      [],
    );
    expect(new Set(khoans.map((k) => k.chuong)).size).toBe(17);
  });

  it('AP-01-AC02: every text is normalised and has no leading Khoản number', () => {
    for (const k of khoans) {
      expect(k.text, `${k.dieu}.${k.khoan}`).toBe(
        k.text.normalize('NFC').replace(/\s+/gu, ' ').trim(),
      );
      expect(k.text).not.toBe('');
    }
    expect(find(2, 1).text).toMatch(/^Người lao động, người học nghề/u);
  });
});

describe('parser rules on small inputs', () => {
  const header = ['Chương I', 'CHUNG'];

  it('AP-01-AC02: NFD and NFC input produce the same output', () => {
    const html = doc(...header, 'Điều 1. Thử việc', 'Thời gian thử việc.');
    expect(parseLaw(html.normalize('NFD'))).toEqual(parseLaw(html));
  });

  it('splits "Chương II<br>TITLE" instead of gluing the number to the title', () => {
    const html = doc(
      'Chương I<br>CHUNG',
      'Điều 1. A',
      'x',
      'Chương II<br>VIỆC LÀM',
      'Điều 2. B',
      'y',
    );
    expect(parseLaw(html).map((k) => k.chuong)).toEqual(['Chương I. CHUNG', 'Chương II. VIỆC LÀM']);
  });

  it('skips Mục headings instead of appending them to the previous Khoản', () => {
    const html = doc(...header, 'Điều 1. A', '1. Một.', 'Mục 1. GIAO KẾT', 'Điều 2. B', 'y');
    expect(parseLaw(html).map((k) => k.text)).toEqual(['Một.', 'y']);
  });

  it('keeps a lead-in as Khoản 0 and a Điều without Khoản as Khoản 0', () => {
    const html = doc(
      ...header,
      'Điều 1. A',
      'Dẫn:',
      '1. Một.',
      '2. Hai.',
      'Điều 2. B',
      'Chỉ có chữ.',
    );
    expect(parseLaw(html).map((k) => `${k.dieu}.${k.khoan}`)).toEqual(['1.0', '1.1', '1.2', '2.0']);
  });

  it('refuses out-of-order Điều, out-of-order Khoản and numbered lines it cannot place', () => {
    expect(() => parseLaw(doc(...header, 'Điều 1. A', 'x', 'Điều 3. C', 'y'))).toThrow(
      /Điều out of order/u,
    );
    expect(() => parseLaw(doc(...header, 'Điều 1. A', '1. a', '3. c'))).toThrow(
      /Khoản 3 out of order/u,
    );
  });

  it('refuses quotation marks outside Điều 219', () => {
    expect(() => parseLaw(doc(...header, 'Điều 1. A', '“trích dẫn'))).toThrow(/only Điều 219/u);
  });

  it('refuses unknown HTML entities, invisible characters and a truncated file', () => {
    expect(() => parseLaw(doc(...header, 'Điều 1. A', 'a &amp; b'))).toThrow(/entity/u);
    expect(() => parseLaw(doc(...header, 'Điều 1. A', 'a​b'))).toThrow(/invisible/u);
    expect(() => parseLaw(`<p>Chương I</p><p>CHUNG</p><p>Điều 1. A</p><p>x</p>`)).toThrow(
      /closing clause/u,
    );
  });
});
