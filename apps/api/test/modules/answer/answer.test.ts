import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createAnswerService,
  NO_BASIS_ANSWER,
} from '../../../src/modules/answer/answer.service.js';
import {
  MIN_QUOTE_LENGTH,
  buildUserPrompt,
  SYSTEM_PROMPT,
} from '../../../src/modules/answer/answer.prompt.js';
import type { Candidate } from '../../../src/modules/retrieval/retrieval.service.js';
import { LlmError, type LlmClient, type LlmRequest } from '../../../src/shared/llm.js';
import { createLogger } from '../../../src/shared/logger.js';

const candidates: Candidate[] = [
  {
    id: 'C1',
    dieu: 25,
    khoan: 2,
    dieuTitle: 'Thời gian thử việc',
    text: 'Không quá 60 ngày đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ cao đẳng trở lên;',
    score: 3,
  },
  {
    id: 'C2',
    dieu: 25,
    khoan: 3,
    dieuTitle: 'Thời gian thử việc',
    text: 'Không quá 30 ngày đối với công việc có chức danh cần trình độ trung cấp nghề, trung cấp chuyên nghiệp;',
    score: 2,
  },
  {
    id: 'C3',
    dieu: 26,
    khoan: 0,
    dieuTitle: 'Tiền lương thử việc',
    text: 'Tiền lương của người lao động trong thời gian thử việc do hai bên thỏa thuận.',
    score: 1,
  },
];
const QUESTION = 'Thử việc tối đa bao lâu với công việc cần bằng cao đẳng?';
const GOOD_QUOTE = 'Không quá 60 ngày đối với công việc có chức danh nghề nghiệp';

const reply = (value: unknown) => JSON.stringify(value);
const answered = (overrides: Record<string, unknown> = {}) =>
  reply({
    noBasis: false,
    answer: 'Theo Điều 25 Khoản 2, thời gian thử việc tối đa là 60 ngày.',
    citations: [{ candidateId: 'C1', quote: GOOD_QUOTE }],
    ...overrides,
  });

// Each entry is the next LLM reply: a string is returned, an Error is thrown.
function fakeLlm(...replies: (string | Error)[]) {
  const complete = vi.fn(async (request: LlmRequest): Promise<string> => {
    void request;
    const next = replies.shift();
    if (next === undefined) throw new Error('no more scripted replies');
    if (next instanceof Error) throw next;
    return next;
  });
  return { llm: { complete } satisfies LlmClient, complete };
}

const service = (llm: LlmClient) => createAnswerService({ llm, logger: createLogger('silent') });

describe('AP-04-AC01 answers in Vietnamese with citations', () => {
  it('returns the answer and each citation with its Điều, Khoản and quote', async () => {
    const { llm, complete } = fakeLlm(answered());
    const outcome = await service(llm).answer(QUESTION, candidates);

    expect(outcome).toEqual({
      kind: 'answered',
      noBasis: false,
      answer: 'Theo Điều 25 Khoản 2, thời gian thử việc tối đa là 60 ngày.',
      citations: [
        {
          candidateId: 'C1',
          dieu: 25,
          khoan: 2,
          dieuTitle: 'Thời gian thử việc',
          quote: GOOD_QUOTE,
        },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('normalises each quote with the corpus rules (NFC, collapsed whitespace)', async () => {
    const messy = `  ${GOOD_QUOTE.normalize('NFD')}\n  `.replace(' ngày', '   ngày');
    const { llm } = fakeLlm(answered({ citations: [{ candidateId: 'C1', quote: messy }] }));
    const outcome = await service(llm).answer(QUESTION, candidates);
    expect(outcome).toMatchObject({ citations: [{ quote: GOOD_QUOTE }] });
  });

  it('accepts JSON inside a code fence or surrounded by text', async () => {
    const { llm } = fakeLlm(`Đây là kết quả:\n\`\`\`json\n${answered()}\n\`\`\``);
    expect(await service(llm).answer(QUESTION, candidates)).toMatchObject({ kind: 'answered' });
  });
});

describe('AP-04-AC02 a citation must name a candidate that was provided', () => {
  it.each([['C9'], ['C0'], ['Điều 999'], ['']])('drops unknown id %j', async (id) => {
    const { llm } = fakeLlm(
      answered({
        citations: [
          { candidateId: id, quote: GOOD_QUOTE },
          { candidateId: 'C1', quote: GOOD_QUOTE },
        ],
      }),
    );
    const outcome = await service(llm).answer(QUESTION, candidates);
    expect(outcome).toMatchObject({ kind: 'answered' });
    if (outcome.kind === 'answered') {
      expect(outcome.citations.map((c) => c.candidateId)).toEqual(['C1']);
    }
  });

  it('accepts a candidate id in another case or in brackets', async () => {
    const { llm } = fakeLlm(
      answered({ citations: [{ candidateId: ' [c2] ', quote: GOOD_QUOTE }] }),
    );
    const outcome = await service(llm).answer(QUESTION, candidates);
    expect(outcome).toMatchObject({ citations: [{ candidateId: 'C2', khoan: 3 }] });
  });

  it('leaves no citations (not a failure) when every cited id is unknown', async () => {
    const { llm, complete } = fakeLlm(
      answered({ citations: [{ candidateId: 'C9', quote: GOOD_QUOTE }] }),
    );
    const outcome = await service(llm).answer(QUESTION, candidates);
    // Empty citations flow on to the checker, which refunds with NO_CITATION (AP-05-AC02).
    expect(outcome).toMatchObject({ kind: 'answered', noBasis: false, citations: [] });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('AP-04-AC03 questions outside the law get the fixed sentence and no citations', () => {
  it('replaces the answer and clears citations when noBasis is true', async () => {
    const { llm } = fakeLlm(
      reply({
        noBasis: true,
        answer: 'Câu hỏi này nói về phở.',
        citations: [{ candidateId: 'C1', quote: GOOD_QUOTE }],
      }),
    );
    expect(await service(llm).answer('Cách nấu phở bò?', candidates)).toEqual({
      kind: 'answered',
      noBasis: true,
      answer: NO_BASIS_ANSWER,
      citations: [],
    });
  });

  it('accepts noBasis with an empty answer', async () => {
    const { llm } = fakeLlm(reply({ noBasis: true, answer: '', citations: [] }));
    expect(await service(llm).answer('Cách nấu phở bò?', candidates)).toMatchObject({
      noBasis: true,
    });
  });
});

describe('AP-04-AC04 an LLM that fails is retried once, then reported as failed', () => {
  it('retries once after a transport error and uses the second reply', async () => {
    const { llm, complete } = fakeLlm(new LlmError('timeout'), answered());
    expect(await service(llm).answer(QUESTION, candidates)).toMatchObject({ kind: 'answered' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['not JSON', 'xin lỗi, tôi không biết'],
    ['wrong shape', reply({ answer: 'x' })],
    ['answer over 1200 characters', answered({ answer: 'a'.repeat(1201) })],
    [
      'more than 5 citations',
      answered({
        citations: Array.from({ length: 6 }, () => ({ candidateId: 'C1', quote: GOOD_QUOTE })),
      }),
    ],
    ['empty answer without noBasis', answered({ answer: '   ' })],
  ])('retries once when the reply is %s', async (_name, bad) => {
    const { llm, complete } = fakeLlm(bad, answered());
    expect(await service(llm).answer(QUESTION, candidates)).toMatchObject({ kind: 'answered' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('is failed, not thrown, after two bad attempts', async () => {
    const { llm, complete } = fakeLlm(new LlmError('rate-limited', 429), 'garbage');
    expect(await service(llm).answer(QUESTION, candidates)).toEqual({ kind: 'failed' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('passes the call timeout and never calls a third time', async () => {
    const { llm, complete } = fakeLlm(new LlmError('timeout'), new LlmError('timeout'), answered());
    const outcome = await createAnswerService({
      llm,
      logger: createLogger('silent'),
      timeoutMs: 1234,
    }).answer(QUESTION, candidates);
    expect(outcome).toEqual({ kind: 'failed' });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 1234 });
  });
});

describe('short quotes (found in POC-3)', () => {
  const short = answered({ citations: [{ candidateId: 'C1', quote: 'Sa thải.' }] });

  it('retries once with a reminder and uses the better reply', async () => {
    const { llm, complete } = fakeLlm(short, answered());
    const outcome = await service(llm).answer(QUESTION, candidates);
    expect(outcome).toMatchObject({ citations: [{ quote: GOOD_QUOTE }] });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].user).toContain(`ít nhất ${MIN_QUOTE_LENGTH} ký tự`);
    expect(complete.mock.calls[0]?.[0].user).not.toContain('lần trả lời trước');
  });

  it('keeps the short answer for the checker when the retry fails outright', async () => {
    const { llm } = fakeLlm(short, new LlmError('timeout'));
    expect(await service(llm).answer(QUESTION, candidates)).toMatchObject({
      kind: 'answered',
      citations: [{ quote: 'Sa thải.' }],
    });
  });

  it('still returns the second reply when it is short too (the checker decides)', async () => {
    const { llm, complete } = fakeLlm(short, short);
    expect(await service(llm).answer(QUESTION, candidates)).toMatchObject({
      citations: [{ quote: 'Sa thải.' }],
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe('prompt', () => {
  it('gives the model every candidate with its id, Điều, Khoản and full text, and the question', () => {
    const prompt = buildUserPrompt(QUESTION, candidates);
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain('[C1] Điều 25 Khoản 2 (Thời gian thử việc): Không quá 60 ngày');
    expect(prompt).toContain('[C3] Điều 26 (Tiền lương thử việc)'); // khoan 0: no "Khoản"
    for (const candidate of candidates) expect(prompt).toContain(candidate.text);
  });

  it('tells the model to answer only in JSON from the candidates', () => {
    expect(SYSTEM_PROMPT).toContain('DUY NHẤT một đối tượng JSON');
    expect(SYSTEM_PROMPT).toContain('NGUYÊN VĂN');
  });
});

describe('boundary (codebase.md §3): AI never touches money', () => {
  it('the answer module imports nothing from payment, the chain or viem', () => {
    for (const file of ['answer.service.ts', 'answer.prompt.ts']) {
      const source = readFileSync(
        new URL(`../../../src/modules/answer/${file}`, import.meta.url),
        'utf8',
      );
      // Only real import statements count; comments may use these words.
      const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map(
        (match) => match[1] ?? '',
      );
      expect(imports.length).toBeGreaterThan(0);
      for (const specifier of imports) expect(specifier).not.toMatch(/payment|tx-queue|chain|viem/);
    }
  });
});
