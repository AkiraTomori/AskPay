// The checker (AP-05): decides whether an answer's citations are good and signs that verdict with
// its own key (T-04). It never touches money (it does not import payment) and it signs exactly
// what it checked (T-13): the answer, and the quotes after C2.
//
// It does NOT verify `textHash` or Merkle proofs. That is the chain's job (system-design §5.4), and
// it is what lets the demo's fake citation (§5.5) get a valid `pass = true` signature and still be
// refunded as INVALID_CITATION. So `textHash` is signed over as received, never looked up or
// recomputed here.
import { z } from 'zod';
import type { Hex } from 'viem';
import { normalizeText } from '@askpay/corpus/normalize';
import { citationsHash as hashCitations, hashText, type Citation } from '@askpay/shared/leaf';
import { verdictTypedData } from '@askpay/shared/verdict';
import { LLM_CALL_TIMEOUT_MS } from '../../shared/config.js';
import type { LlmClient } from '../../shared/llm.js';
import type { Logger } from '../../shared/logger.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt, judgeId } from './checker.prompt.js';

// C2: a shorter quote cannot be told apart from a few common words. The answer step asks the model
// for the same minimum (answer.prompt.ts); a test keeps the two equal.
export const MIN_QUOTE_LENGTH = 15;

// One Khoản of the corpus, by position. The checker finds the text by (dieu, khoan).
export interface KhoanText {
  dieu: number;
  khoan: number;
  text: string;
}

export interface CheckCitation {
  lawId: Hex;
  dieu: number;
  khoan: number;
  textHash: Hex;
  quote: string;
}

// `question` is an input beyond the hashes (system-design §5.4): C4 judges relevance to it.
export interface CheckInput {
  qid: Hex;
  question: string;
  answer: string;
  citations: readonly CheckCitation[];
}

export type RejectedAt = 'C2' | 'C3' | 'C4';

export type CheckOutcome =
  // C1. Nothing to sign: the provider settles with an empty list and the chain refunds NO_CITATION.
  | { kind: 'no-citation' }
  | {
      kind: 'signed';
      pass: boolean;
      // Set when pass is false: the first step that failed. Logged, never sent on-chain.
      rejectedAt?: RejectedAt;
      answerHash: Hex;
      citationsHash: Hex;
      // Aligned with the input citations. ask.service builds Citation[] from these and must not
      // hash the quotes again.
      quoteHashes: Hex[];
      signature: Hex;
    }
  // C4 could not be judged, or the signer failed. Never signed as pass=false: that would say the
  // quotes are wrong when nobody checked (AP-04-AC05, Q-11).
  | { kind: 'failed' };

export interface VerdictSigner {
  signTypedData(typedData: ReturnType<typeof verdictTypedData>): Promise<Hex>;
}

export interface CheckerService {
  check(input: CheckInput): Promise<CheckOutcome>;
}

export interface CheckerDeps {
  llm: LlmClient;
  logger: Logger;
  // The checker's account, not the provider's. Its address is the escrow's `checker`.
  signer: VerdictSigner;
  escrow: Hex;
  corpus: readonly KhoanText[];
  timeoutMs?: number;
}

const judgeSchema = z.object({
  judgements: z.array(
    z.object({
      id: z.string(),
      relevant: z
        .string()
        .transform((value) => value.trim().toLowerCase())
        .pipe(z.enum(['yes', 'no'])),
    }),
  ),
});

// "Điều 35" in any case. The lookbehind keeps it from matching inside another word.
const DIEU_MENTION = /(?<!\p{L})điều\s+(\d+)/giu;

// C3: every "Điều N" the answer names must be one of the cited Điều.
function mentionsUncitedDieu(answer: string, citedDieu: ReadonlySet<number>): boolean {
  for (const match of answer.normalize('NFC').matchAll(DIEU_MENTION)) {
    if (!citedDieu.has(Number(match[1]))) return true;
  }
  return false;
}

// The model's reply, one yes/no per Khoản and no more: a missing, duplicate or unknown id makes the
// reply unusable rather than guessed at.
function parseJudgement(text: string, count: number): boolean[] | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: ReturnType<typeof judgeSchema.safeParse>;
  try {
    parsed = judgeSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return undefined;
  }
  if (!parsed.success || parsed.data.judgements.length !== count) return undefined;
  const verdicts: boolean[] = [];
  for (let position = 0; position < count; position += 1) {
    const matches = parsed.data.judgements.filter((item) => item.id.trim() === judgeId(position));
    if (matches.length !== 1 || !matches[0]) return undefined;
    verdicts.push(matches[0].relevant === 'yes');
  }
  return verdicts;
}

export function createCheckerService(deps: CheckerDeps): CheckerService {
  const { llm, logger, signer, escrow } = deps;
  const timeoutMs = deps.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  const khoanText = new Map<string, string>();
  for (const doc of deps.corpus) khoanText.set(`${doc.dieu}.${doc.khoan}`, normalizeText(doc.text));

  // C4: one call for every cited Khoản, retried once (a call per Khoản could outrun the pipeline
  // budget and Groq's token limit). undefined means it could not be judged.
  async function judge(
    input: CheckInput,
    texts: readonly string[],
  ): Promise<boolean[] | undefined> {
    const user = buildJudgePrompt(
      input.question,
      input.citations.map((citation, position) => ({
        dieu: citation.dieu,
        khoan: citation.khoan,
        text: texts[position] ?? '',
      })),
    );
    for (const attempt of [1, 2]) {
      let reply: string;
      try {
        reply = await llm.complete({ system: JUDGE_SYSTEM_PROMPT, user, timeoutMs });
      } catch (error) {
        logger.warn(
          { qid: input.qid, attempt, kind: error instanceof Error ? error.message : 'unknown' },
          'checker: judge call failed',
        );
        continue;
      }
      const verdicts = parseJudgement(reply, input.citations.length);
      if (verdicts) return verdicts;
      logger.warn({ qid: input.qid, attempt }, 'checker: judge reply is unusable');
    }
    return undefined;
  }

  async function check(input: CheckInput): Promise<CheckOutcome> {
    // C1
    if (input.citations.length === 0) return { kind: 'no-citation' };

    // The strings that get hashed are the ones C2 checks: normalised quotes, the exact answer.
    const prepared = input.citations.map((citation) => {
      const quote = normalizeText(citation.quote);
      return { citation, quote, quoteHash: hashText(quote) };
    });
    const quoteHashes = prepared.map((item) => item.quoteHash);
    const answerHash = hashText(input.answer);
    const citations: Citation[] = prepared.map(({ citation, quoteHash }) => ({
      lawId: citation.lawId,
      dieu: citation.dieu,
      khoan: citation.khoan,
      textHash: citation.textHash,
      quoteHash,
    }));
    const citationsHash = hashCitations(citations);

    async function sign(pass: boolean, rejectedAt?: RejectedAt): Promise<CheckOutcome> {
      try {
        const signature = await signer.signTypedData(
          verdictTypedData({ escrow, qid: input.qid, answerHash, citationsHash, pass }),
        );
        return {
          kind: 'signed',
          pass,
          ...(rejectedAt ? { rejectedAt } : {}),
          answerHash,
          citationsHash,
          quoteHashes,
          signature,
        };
      } catch {
        // Nothing from the signer is logged: its error may carry key material.
        logger.error({ qid: input.qid }, 'checker: signing failed');
        return { kind: 'failed' };
      }
    }

    // C2: every quote is a substring of the Khoản it cites, and long enough to mean something.
    const texts = prepared.map(
      ({ citation }) => khoanText.get(`${citation.dieu}.${citation.khoan}`) ?? '',
    );
    const quotesAreVerbatim = prepared.every(
      ({ quote }, position) =>
        quote.length >= MIN_QUOTE_LENGTH && (texts[position] ?? '').includes(quote),
    );
    if (!quotesAreVerbatim) return sign(false, 'C2');

    // C3
    const citedDieu = new Set(input.citations.map((citation) => citation.dieu));
    if (mentionsUncitedDieu(input.answer, citedDieu)) return sign(false, 'C3');

    // C4
    const verdicts = await judge(input, texts);
    if (!verdicts) return { kind: 'failed' };
    return verdicts.every(Boolean) ? sign(true) : sign(false, 'C4');
  }

  return { check };
}
