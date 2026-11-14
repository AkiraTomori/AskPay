// Turns a question and its retrieved candidates into an answer with citations (AP-04). It never
// touches money: it does not import payment, and it cannot cite anything it was not handed.
import { z } from 'zod';
import { normalizeText } from '@askpay/corpus/normalize';
import { LLM_CALL_TIMEOUT_MS } from '../../shared/config.js';
import type { LlmClient } from '../../shared/llm.js';
import type { Logger } from '../../shared/logger.js';
import type { Candidate } from '../retrieval/retrieval.service.js';
import {
  MIN_QUOTE_LENGTH,
  SHORT_QUOTE_HINT,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from './answer.prompt.js';

// AP-04-AC03: the fixed sentence for a question the law does not cover.
export const NO_BASIS_ANSWER = 'Không tìm thấy căn cứ trong Bộ luật Lao động 2019';
export const MAX_ANSWER_LENGTH = 1200;
export const MAX_CITATIONS = 5;

// What the model must return (system-design §5.3). Strict on shape, lenient on content: the checker
// judges the content.
export const answerOutputSchema = z
  .object({
    noBasis: z.boolean(),
    answer: z.string().max(MAX_ANSWER_LENGTH),
    citations: z.array(z.object({ candidateId: z.string(), quote: z.string() })).max(MAX_CITATIONS),
  })
  .refine((output) => output.noBasis || output.answer.trim().length > 0, 'empty answer');
type AnswerOutput = z.infer<typeof answerOutputSchema>;

export interface AnswerCitation {
  candidateId: string;
  dieu: number;
  khoan: number;
  dieuTitle: string;
  // normalizeText(quote): the one string the checker verifies, the DB stores and the UI shows
  // (system-design §5.3), so the hash of it is also what a reader sees.
  quote: string;
}

export type AnswerOutcome =
  | { kind: 'answered'; noBasis: boolean; answer: string; citations: AnswerCitation[] }
  // The model gave nothing usable after one retry. ask.service refunds with ANSWER_FAILED.
  | { kind: 'failed' };

export interface AnswerService {
  answer(question: string, candidates: readonly Candidate[]): Promise<AnswerOutcome>;
}

export interface AnswerDeps {
  llm: LlmClient;
  logger: Logger;
  timeoutMs?: number;
}

// Models wrap JSON in code fences or add a sentence around it; the outermost braces are the JSON.
function parseOutput(text: string): AnswerOutput | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = answerOutputSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// "C1", "c1" and "[C1]" all mean candidate C1; anything else is not a candidate.
function candidateFor(id: string, candidates: readonly Candidate[]): Candidate | undefined {
  const normalised = id
    .trim()
    .replace(/^\[|\]$/g, '')
    .toUpperCase();
  return candidates.find((candidate) => candidate.id === normalised);
}

// AP-04-AC02: a citation survives only if it names a candidate that was actually provided.
function toOutcome(output: AnswerOutput, candidates: readonly Candidate[]): AnswerOutcome {
  if (output.noBasis) {
    return { kind: 'answered', noBasis: true, answer: NO_BASIS_ANSWER, citations: [] };
  }
  const citations = output.citations.flatMap((citation): AnswerCitation[] => {
    const candidate = candidateFor(citation.candidateId, candidates);
    if (!candidate) return [];
    return [
      {
        candidateId: candidate.id,
        dieu: candidate.dieu,
        khoan: candidate.khoan,
        dieuTitle: candidate.dieuTitle,
        quote: normalizeText(citation.quote),
      },
    ];
  });
  return { kind: 'answered', noBasis: false, answer: output.answer, citations };
}

const hasShortQuote = (outcome: AnswerOutcome) =>
  outcome.kind === 'answered' &&
  outcome.citations.some((citation) => citation.quote.length < MIN_QUOTE_LENGTH);

export function createAnswerService(deps: AnswerDeps): AnswerService {
  const { llm, logger } = deps;
  const timeoutMs = deps.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  async function answer(
    question: string,
    candidates: readonly Candidate[],
  ): Promise<AnswerOutcome> {
    const basePrompt = buildUserPrompt(question, candidates);
    let hint = '';
    // A reply that parsed but cites a too-short quote. If the retry then fails outright, this is
    // still better than refunding: the checker decides (C2).
    let fallback: AnswerOutcome | undefined;

    for (const attempt of [1, 2]) {
      let reply: string;
      try {
        reply = await llm.complete({ system: SYSTEM_PROMPT, user: basePrompt + hint, timeoutMs });
      } catch (error) {
        logger.warn(
          { attempt, kind: error instanceof Error ? error.message : 'unknown' },
          'answer: LLM call failed',
        );
        continue;
      }
      const output = parseOutput(reply);
      if (!output) {
        logger.warn({ attempt }, 'answer: reply is not valid JSON in the schema');
        continue;
      }
      const outcome = toOutcome(output, candidates);
      if (attempt === 1 && hasShortQuote(outcome)) {
        fallback = outcome;
        hint = SHORT_QUOTE_HINT;
        logger.info({ attempt }, 'answer: short quote, retrying once');
        continue;
      }
      return outcome;
    }
    return fallback ?? { kind: 'failed' };
  }

  return { answer };
}
