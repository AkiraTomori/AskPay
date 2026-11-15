// Request and response schemas for the HTTP API. This file is the source of truth; docs/architecture/api.md
// describes behaviour and examples and must follow it, not the other way round.
import { z } from 'zod';
import { ERROR_CODES, refundReasonCodes } from './errors.js';
import { MAX_UINT256, UNITS_PATTERN } from './money.js';

export const MAX_QUESTION_LENGTH = 500;

const hexString = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`), `expected ${bytes}-byte lowercase hex`);

export const bytes32Schema = hexString(32);
export const addressSchema = hexString(20);
// Amounts travel as integer strings; callers convert with parseUnits from ./money.
// One refine, not regex + refine: zod runs every check, so BigInt() would throw on a bad string.
export const amountSchema = z
  .string()
  .refine(
    (value) => UNITS_PATTERN.test(value) && BigInt(value) <= MAX_UINT256,
    'expected an integer string within uint256',
  );

// --- Envelope -------------------------------------------------------------------------------

const errorCodes = Object.keys(ERROR_CODES) as [
  keyof typeof ERROR_CODES,
  ...(keyof typeof ERROR_CODES)[],
];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function dataEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: z.record(z.string(), z.unknown()).optional() });
}

// --- POST /api/ask --------------------------------------------------------------------------

export const askRequestSchema = z.object({
  // Normalise to NFC first: decomposed Vietnamese (e.g. from IME or paste) would otherwise count
  // each combining mark toward the limit and break the "same question as the quote" comparison.
  question: z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    .pipe(z.string().min(1).max(MAX_QUESTION_LENGTH)),
  qid: bytes32Schema.optional(),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

// --- Question result (api.md §3.2, §4) -------------------------------------------------------

export const questionStatusSchema = z.enum(['PENDING', 'PAID', 'REFUNDED', 'CLAIMABLE']);
export const questionStageSchema = z.enum([
  'QUOTED',
  'DEPOSITING',
  'ANSWERING',
  'CHECKING',
  'SETTLING',
  'PAID',
  'REFUNDED',
  'EXPIRED',
]);
export const refundReasonSchema = z.enum(refundReasonCodes);

// 202 body while the pipeline is still running (api.md §3.3); the client polls GET /questions/:qid.
export const askAcceptedSchema = z.object({ qid: bytes32Schema, stage: questionStageSchema });
export type AskAccepted = z.infer<typeof askAcceptedSchema>;

// `details` of PAYMENT_INVALID when the payer cannot cover the price (AP-03-AC05): the UI shows the
// balance, the price and a faucet link. Nothing is sent on-chain in that case.
export const insufficientBalanceDetailsSchema = z.object({
  reason: z.literal('INSUFFICIENT_BALANCE'),
  balance: amountSchema,
  price: amountSchema,
  faucetUrl: z.string().url(),
});
export type InsufficientBalanceDetails = z.infer<typeof insufficientBalanceDetailsSchema>;

export const citationSchema = z.object({
  lawId: bytes32Schema,
  dieu: z.number().int().positive(),
  khoan: z.number().int().nonnegative(),
  dieuTitle: z.string(),
  quote: z.string(),
  text: z.string(),
  textHash: bytes32Schema,
  quoteHash: bytes32Schema,
  verifiedOnChain: z.boolean(),
});
export type Citation = z.infer<typeof citationSchema>;

const txHashSchema = bytes32Schema;

export const questionResultSchema = z.object({
  qid: bytes32Schema,
  question: z.string(),
  status: questionStatusSchema.optional(),
  stage: questionStageSchema,
  reason: refundReasonSchema.nullable().optional(),
  amount: amountSchema.optional(),
  payer: addressSchema.optional(),
  answer: z.string().nullable().optional(),
  noBasis: z.boolean().optional(),
  citations: z.array(citationSchema).optional(),
  answerHash: bytes32Schema.nullable().optional(),
  citationsHash: bytes32Schema.nullable().optional(),
  tx: z.object({ deposit: txHashSchema.optional(), settle: txHashSchema.optional() }).optional(),
  deadline: z.number().int().optional(),
  createdAt: z.number().int().optional(),
});
export type QuestionResult = z.infer<typeof questionResultSchema>;

// --- GET /api/questions, /stats, /corpus, /health ------------------------------------------

export const questionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const questionListItemSchema = z.object({
  qid: bytes32Schema,
  question: z.string(),
  status: questionStatusSchema,
  reason: refundReasonSchema.nullable(),
  amount: amountSchema,
  createdAt: z.number().int(),
  tx: z.object({ settle: txHashSchema.optional() }),
});

export type QuestionListItem = z.infer<typeof questionListItemSchema>;

// eval/results/latest.json (AP-09-AC03): what the dashboard shows of the last eval run.
export const evalSummarySchema = z.object({
  runAt: z.string(),
  commit: z.string(),
  citationAccuracy: z.number(),
  checkerPassRate: z.number(),
  outOfScopeCorrect: z.number(),
});

export const statsSchema = z.object({
  questions: z.number().int().nonnegative(),
  paid: z.number().int().nonnegative(),
  refunded: z.number().int().nonnegative(),
  refundRate: z.number().min(0).max(1),
  refundsByReason: z.record(refundReasonSchema, z.number().int().nonnegative()),
  providerRevenue: amountSchema,
  lastIndexedBlock: z.number().int().nonnegative(),
  eval: evalSummarySchema.nullable(),
});
export type Stats = z.infer<typeof statsSchema>;

export const corpusInfoSchema = z.object({
  lawId: bytes32Schema,
  lawName: z.string(),
  khoanCount: z.number().int().positive(),
  dieuCount: z.number().int().positive(),
  repoRoot: bytes32Schema,
  onChainRoot: bytes32Schema,
  rootMatches: z.boolean(),
  escrow: addressSchema,
  explorer: z.string().url(),
});

export const healthSchema = z.object({
  ok: z.boolean(),
  rpc: z.enum(['ok', 'down']),
  llm: z.enum(['ok', 'down']),
  providerBalanceAvax: z.string(),
  lowBalance: z.boolean(),
  indexerLagBlocks: z.number().int().nonnegative(),
});

export type CorpusInfo = z.infer<typeof corpusInfoSchema>;
export type Health = z.infer<typeof healthSchema>;
