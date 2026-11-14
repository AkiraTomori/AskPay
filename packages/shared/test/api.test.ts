import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_LENGTH,
  addressSchema,
  amountSchema,
  askAcceptedSchema,
  askRequestSchema,
  bytes32Schema,
  citationSchema,
  errorEnvelopeSchema,
  questionListQuerySchema,
  questionResultSchema,
  statsSchema,
} from '../src/api.js';

const qid = `0x${'9f'.repeat(32)}`;

describe('askRequestSchema', () => {
  it('accepts a quote request and a payment retry', () => {
    expect(askRequestSchema.safeParse({ question: 'Thử việc tối đa bao lâu?' }).success).toBe(true);
    expect(askRequestSchema.safeParse({ question: 'x', qid }).success).toBe(true);
  });

  it('rejects empty, whitespace-only and over-long questions', () => {
    expect(askRequestSchema.safeParse({ question: '' }).success).toBe(false);
    expect(askRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(
      askRequestSchema.safeParse({ question: 'a'.repeat(MAX_QUESTION_LENGTH + 1) }).success,
    ).toBe(false);
    expect(askRequestSchema.safeParse({ question: 'a'.repeat(MAX_QUESTION_LENGTH) }).success).toBe(
      true,
    );
  });

  it('AP-02-AC02 counts characters after NFC normalisation, not UTF-16 units', () => {
    const nfd = 'e\u0323\u0302'.repeat(200); // 200 decomposed "ệ", 600 code units
    const parsed = askRequestSchema.safeParse({ question: nfd });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.question).toBe('\u1ec7'.repeat(200));
  });

  it('rejects a malformed qid', () => {
    expect(askRequestSchema.safeParse({ question: 'x', qid: '0xABC' }).success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  it('only allows known codes', () => {
    const ok = { error: { code: 'QUESTION_NOT_FOUND', message: 'm' } };
    expect(errorEnvelopeSchema.safeParse(ok).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { code: 'NOPE', message: 'm' } }).success).toBe(
      false,
    );
  });
});

describe('questionResultSchema', () => {
  it('accepts a quoted question that only has qid, question and stage', () => {
    expect(questionResultSchema.safeParse({ qid, question: 'x', stage: 'QUOTED' }).success).toBe(
      true,
    );
  });
});

describe('askAcceptedSchema', () => {
  it('parses the 202 in-flight body from api.md §3.3', () => {
    expect(askAcceptedSchema.safeParse({ qid, stage: 'DEPOSITING' }).success).toBe(true);
    expect(askAcceptedSchema.safeParse({ qid, stage: 'NOPE' }).success).toBe(false);
  });
});

const hash = `0x${'ab'.repeat(32)}`;
const address = `0x${'cd'.repeat(20)}`;

describe('amountSchema', () => {
  it('rejects non-integer strings and values above uint256', () => {
    expect(amountSchema.safeParse('50000').success).toBe(true);
    expect(amountSchema.safeParse('1.5').success).toBe(false);
    expect(amountSchema.safeParse('9'.repeat(100)).success).toBe(false);
  });
});

describe('hex schemas', () => {
  it('rejects uppercase hex and wrong lengths', () => {
    expect(bytes32Schema.safeParse(hash.toUpperCase().replace('0X', '0x')).success).toBe(false);
    expect(bytes32Schema.safeParse(address).success).toBe(false);
    expect(addressSchema.safeParse(address).success).toBe(true);
  });
});

describe('citationSchema', () => {
  const citation = {
    lawId: hash,
    dieu: 25,
    khoan: 0,
    dieuTitle: 'Thời gian thử việc',
    quote: 'không quá 60 ngày',
    text: 'nguyên văn',
    textHash: hash,
    quoteHash: hash,
    verifiedOnChain: false,
  };

  it('allows khoan 0 (Điều without numbered Khoản) but not dieu 0', () => {
    expect(citationSchema.safeParse(citation).success).toBe(true);
    expect(citationSchema.safeParse({ ...citation, dieu: 0 }).success).toBe(false);
  });
});

describe('questionListQuerySchema', () => {
  it('defaults limit to 20, coerces strings and caps at 100', () => {
    expect(questionListQuerySchema.parse({}).limit).toBe(20);
    expect(questionListQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(questionListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('statsSchema', () => {
  const stats = {
    questions: 42,
    paid: 31,
    refunded: 11,
    refundRate: 0.262,
    refundsByReason: {
      NO_CITATION: 6,
      INVALID_CITATION: 1,
      CHECKER_REJECTED: 3,
      ANSWER_FAILED: 0,
      TIMEOUT: 1,
    },
    providerRevenue: '1550000',
    lastIndexedBlock: 38123456,
    eval: null,
  };

  it('accepts eval null and rejects a refundRate above 1', () => {
    expect(statsSchema.safeParse(stats).success).toBe(true);
    expect(statsSchema.safeParse({ ...stats, refundRate: 1.2 }).success).toBe(false);
  });
});
