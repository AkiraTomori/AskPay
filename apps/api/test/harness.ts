// Shared test setup: the real app wiring (compose) on an in-memory SQLite, with fakes only at the
// edges (backend.md §8): a stateful fake escrow at the payment.chain boundary, a scripted LLM, and
// a clock the test moves. The checker signs with a real key and the fake escrow verifies it the way
// the contract does, so an end-to-end test means something.
import { vi, type Mock } from 'vitest';
import supertest from 'supertest';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createApp } from '../src/app.js';
import { compose } from '../src/compose.js';
import { createLogger } from '../src/shared/logger.js';
import { openStore } from '../src/shared/store.js';
import type { LlmRequest } from '../src/shared/llm.js';
import { JUDGE_SYSTEM_PROMPT } from '../src/modules/checker/checker.prompt.js';
import { DEFAULT_CORPUS_PATH, loadCorpus } from '../src/modules/corpus/corpus.service.js';
import type {
  PaymentChain,
  SettleEvent,
  SettleResult,
} from '../src/modules/payment/payment.chain.js';
import {
  FUJI_NETWORK,
  encodeHeader,
  paymentRequiredSchema,
  receiveAuthorizationTypedData,
  type PaymentRequired,
} from '@askpay/shared/x402';
import { LEAF_ENCODING, citationsHash, leafValues } from '@askpay/shared/leaf';
import { verdictTypedData } from '@askpay/shared/verdict';

export const ESCROW = '0x869E95576f6dD6f06118CF733b4F307Ae37ddce0' as const;
export const TOKEN = '0x5425890298aed601595a70AB815c96711a31Bc65' as const;
export const PRICE = 50_000n;
export const QUESTION = 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?';
export const T0 = 1_762_699_400_000; // fixed clock, unix ms
export const ANSWER_WINDOW = 600;

export const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
export const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);
export const checker = privateKeyToAccount(`0x${'33'.repeat(32)}`);
export const DEPOSIT_TX = `0x${'ab'.repeat(32)}` as Hex;

// The real corpus, built once: 220 Điều is cheap but there is no reason to rebuild it per test.
export const corpus = loadCorpus(DEFAULT_CORPUS_PATH);

// --- A fake escrow that behaves like the contract ------------------------------------------

interface FakeQuestion {
  status: 'None' | 'Open' | 'Paid' | 'Refunded';
  payer: Hex;
  amount: bigint;
  deadline: number; // unix seconds
}

type MockedMethod =
  | 'payerBalance'
  | 'providerCanPayGas'
  | 'txHealthy'
  | 'question'
  | 'latestBlockTimestamp'
  | 'deposit'
  | 'settle'
  | 'refund'
  | 'nonceState'
  | 'receiptOf'
  | 'pendingFees'
  | 'depositedBetween'
  | 'latestBlock';
export type FakeChain = Omit<PaymentChain, MockedMethod> & {
  [Method in MockedMethod]: Mock<PaymentChain[Method]>;
} & {
  // What the test can see and steer.
  questions: Map<Hex, FakeQuestion>;
  block: { time: number; number: number };
  nonce: { latest: number; pending: number };
  // Every tx the fake accepted, in order.
  sent: { fn: 'deposit' | 'settle' | 'refundByProvider'; qid: Hex; hash: Hex }[];
  receipts: Map<Hex, { success: boolean; event?: SettleEvent }>;
  // Puts money in escrow as if a deposit had happened in an earlier life of the server.
  plantDeposit(qid: Hex, deadlineInSeconds?: number): void;
};

const hashOf = (counter: number) => `0x${counter.toString(16).padStart(64, '0')}` as Hex;

// Overrides are always vi.fn() in the tests, so the mock-typed result is accurate.
export function createFakeChain(overrides: Partial<PaymentChain> = {}): FakeChain {
  const questions = new Map<Hex, FakeQuestion>();
  const block = { time: Math.floor(T0 / 1000), number: 1_000 };
  const nonce = { latest: 0, pending: 0 };
  const sent: FakeChain['sent'] = [];
  const receipts: FakeChain['receipts'] = new Map();
  const deposits: { qid: Hex; block: number }[] = [];
  let counter = 0;

  const stateOf = (qid: Hex): FakeQuestion =>
    questions.get(qid) ?? { status: 'None', payer: payer.address, amount: 0n, deadline: 0 };

  function plantDeposit(qid: Hex, deadlineInSeconds = ANSWER_WINDOW) {
    questions.set(qid, {
      status: 'Open',
      payer: payer.address,
      amount: PRICE,
      deadline: block.time + deadlineInSeconds,
    });
    block.number += 1;
    deposits.push({ qid, block: block.number });
  }

  // The contract's `settle` after the signature check (contracts.md §4.2), or null if it reverts.
  async function contractSettle(
    request: Parameters<PaymentChain['settle']>[0],
  ): Promise<{ event: SettleEvent } | { revert: string }> {
    if (request.citations.length === 0)
      return { event: { name: 'Refunded', reason: 'NO_CITATION' } };
    const hash = citationsHash(request.citations);
    const signer = await recoverTypedDataAddress({
      ...verdictTypedData({
        escrow: ESCROW,
        qid: request.qid,
        answerHash: request.answerHash,
        citationsHash: hash,
        pass: request.pass,
      }),
      signature: request.checkerSig,
    }).catch(() => undefined);
    if (signer?.toLowerCase() !== checker.address.toLowerCase()) {
      return { revert: 'InvalidCheckerSignature' };
    }
    if (request.proofs.length !== request.citations.length) return { revert: 'BadCitations' };
    const proofsOk = request.citations.every((citation, position) =>
      StandardMerkleTree.verify(corpus.root, [...LEAF_ENCODING], leafValues(citation), [
        ...(request.proofs[position] ?? []),
      ]),
    );
    if (!proofsOk) return { event: { name: 'Refunded', reason: 'INVALID_CITATION' } };
    if (!request.pass) return { event: { name: 'Refunded', reason: 'CHECKER_REJECTED' } };
    return { event: { name: 'Paid', answerHash: request.answerHash, citationsHash: hash } };
  }

  function close(qid: Hex, event: SettleEvent, fn: 'settle' | 'refundByProvider', hash: Hex) {
    const question = stateOf(qid);
    questions.set(qid, { ...question, status: event.name === 'Paid' ? 'Paid' : 'Refunded' });
    sent.push({ fn, qid, hash });
    receipts.set(hash, { success: true, event });
    nonce.latest += 1;
    nonce.pending += 1;
  }

  const chain = {
    escrow: ESCROW,
    token: TOKEN,
    tokenName: 'USD Coin',
    tokenVersion: '2',
    answerWindowSeconds: ANSWER_WINDOW,
    payerBalance: vi.fn(async () => 10n * PRICE),
    providerCanPayGas: vi.fn(async () => true),
    txHealthy: vi.fn(() => true),
    question: vi.fn(async (qid: Hex) => {
      const question = stateOf(qid);
      return { status: question.status, deadline: question.deadline };
    }),
    latestBlockTimestamp: vi.fn(async () => block.time),
    deposit: vi.fn(async (request, hooks) => {
      const hash = hashOf(++counter);
      hooks?.onSigned?.({ hash, nonce: nonce.pending, replacement: false });
      plantDeposit(request.qid);
      sent.push({ fn: 'deposit', qid: request.qid, hash });
      receipts.set(hash, { success: true });
      nonce.latest += 1;
      nonce.pending += 1;
      return { kind: 'mined' as const, hash, success: true, logs: [] };
    }),
    settle: vi.fn(async (request, choose, hooks): Promise<SettleResult> => {
      const which = await choose();
      if (stateOf(request.qid).status !== 'Open') {
        return { kind: 'not-sent', reason: 'reverted', errorName: 'QuestionNotOpen' };
      }
      let event: SettleEvent;
      if (which === 'refund') event = { name: 'Refunded', reason: 'ANSWER_FAILED' };
      else {
        const result = await contractSettle(request);
        if ('revert' in result) {
          return { kind: 'not-sent', reason: 'reverted', errorName: result.revert };
        }
        event = result.event;
      }
      const hash = hashOf(++counter);
      hooks?.onSigned?.({ hash, nonce: nonce.pending, replacement: false });
      close(request.qid, event, which === 'refund' ? 'refundByProvider' : 'settle', hash);
      return { kind: 'mined', hash, success: true, logs: [], event };
    }),
    refund: vi.fn(async (qid: Hex, hooks): Promise<SettleResult> => {
      if (stateOf(qid).status !== 'Open') {
        return { kind: 'not-sent', reason: 'reverted', errorName: 'QuestionNotOpen' };
      }
      const hash = hashOf(++counter);
      hooks?.onSigned?.({ hash, nonce: nonce.pending, replacement: false });
      const event: SettleEvent = { name: 'Refunded', reason: 'ANSWER_FAILED' };
      close(qid, event, 'refundByProvider', hash);
      return { kind: 'mined', hash, success: true, logs: [], event };
    }),
    nonceState: vi.fn(async () => ({ ...nonce })),
    receiptOf: vi.fn(async (hash: Hex) => receipts.get(hash)),
    pendingFees: vi.fn(async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n })),
    depositedBetween: vi.fn(async (from: bigint, to: bigint) =>
      deposits.filter((d) => BigInt(d.block) >= from && BigInt(d.block) <= to).map((d) => d.qid),
    ),
    latestBlock: vi.fn(async () => BigInt(block.number)),
    ...overrides,
    questions,
    block,
    nonce,
    sent,
    receipts,
    plantDeposit,
  };
  return chain as unknown as FakeChain;
}

// --- A scripted LLM ---------------------------------------------------------------------------

type Reply = (request: LlmRequest) => string;

// Finds the candidate for a Điều and Khoản in the answer prompt and quotes its first words.
export function citeFromPrompt(user: string, dieu: number, khoan: number) {
  const match = new RegExp(`\\[(C\\d+)\\] Điều ${dieu} Khoản ${khoan} \\([^)]*\\): (.+)`).exec(
    user,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return { candidateId: match[1], quote: match[2].slice(0, 60) };
}

const defaultAnswer: Reply = (request) => {
  const cite = citeFromPrompt(request.user, 25, 2);
  return JSON.stringify(
    cite
      ? {
          noBasis: false,
          answer: 'Theo Điều 25 Khoản 2, thời gian thử việc tối đa là 60 ngày.',
          citations: [cite],
        }
      : { noBasis: true, answer: '', citations: [] },
  );
};

const defaultJudge: Reply = (request) => {
  const count = (request.user.match(/^\[K\d+\]/gm) ?? []).length;
  return JSON.stringify({
    judgements: Array.from({ length: count }, (_, i) => ({ id: `K${i + 1}`, relevant: 'yes' })),
  });
};

export function createFakeLlm() {
  const state: { answer: Reply; judge: Reply; calls: LlmRequest[] } = {
    answer: defaultAnswer,
    judge: defaultJudge,
    calls: [],
  };
  const complete = vi.fn(async (request: LlmRequest): Promise<string> => {
    state.calls.push(request);
    return (request.system === JUDGE_SYSTEM_PROMPT ? state.judge : state.answer)(request);
  });
  const judgeCalls = () => state.calls.filter((call) => call.system === JUDGE_SYSTEM_PROMPT).length;
  return { llm: { complete }, state, complete, judgeCalls };
}

// --- The app ------------------------------------------------------------------------------------

export interface TestOptions {
  chain?: ReturnType<typeof createFakeChain>;
  llm?: ReturnType<typeof createFakeLlm>;
  rateLimitPerMinute?: number;
  quoteTtlSeconds?: number;
  requestWaitMs?: number;
  demoFakeCitation?: boolean;
  // Reuse a database to model a restart: a new process over the same file.
  store?: ReturnType<typeof openStore>;
  // A signer that is NOT the escrow's checker, to model a key mismatch.
  checkerSigner?: typeof checker;
  now?: () => number;
  scanChunk?: number;
}

export function createTestApp(options: TestOptions = {}) {
  const chain = options.chain ?? createFakeChain();
  const fakeLlm = options.llm ?? createFakeLlm();
  const store = options.store ?? openStore(':memory:');
  const clock = { now: T0 };
  let salt = 0;
  const logger = createLogger('silent');
  const composed = compose({
    config: {
      priceUnits: PRICE,
      quoteTtlSeconds: options.quoteTtlSeconds ?? 300,
      demoFakeCitation: options.demoFakeCitation ?? false,
    },
    store,
    chain,
    logger,
    llm: fakeLlm.llm,
    checkerSigner: options.checkerSigner ?? checker,
    corpus,
    deploymentBlock: 0n,
    now: options.now ?? (() => clock.now),
    randomSalt: () => `0x${(++salt).toString(16).padStart(32, '0')}`,
    requestWaitMs: options.requestWaitMs ?? 5_000,
    scanPauseMs: 0,
    ...(options.scanChunk ? { scanChunk: options.scanChunk } : {}),
  });
  const app = createApp({
    askService: composed.askService,
    rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
    logger,
  });
  return { api: supertest(app), chain, store, clock, llm: fakeLlm, ...composed };
}

export type TestApp = ReturnType<typeof createTestApp>;

// The one requirement a quote carries; fails loudly instead of using a non-null assertion.
export function requirementOf(quote: PaymentRequired) {
  const [requirement] = quote.accepts;
  if (!requirement) throw new Error('quote has no requirement');
  return requirement;
}

export async function requestQuote(test: TestApp, question = QUESTION): Promise<PaymentRequired> {
  const response = await test.api.post('/api/ask').send({ question });
  return paymentRequiredSchema.parse(response.body);
}

export interface PaymentOverrides {
  signer?: typeof payer;
  to?: string;
  value?: bigint;
  nonce?: Hex;
  validAfter?: bigint;
  validBefore?: bigint;
  acceptedAmount?: string;
}

// Builds a PAYMENT-SIGNATURE header the way a real client would: sign what the 402 asked for.
export async function signPayment(
  quote: PaymentRequired,
  overrides: PaymentOverrides = {},
): Promise<string> {
  const requirement = requirementOf(quote);
  const signer = overrides.signer ?? payer;
  const authorization = {
    from: payer.address, // always the payer; a different signer then makes the signature wrong
    to: (overrides.to ?? requirement.payTo) as Hex,
    value: overrides.value ?? BigInt(requirement.amount),
    validAfter: overrides.validAfter ?? 0n,
    validBefore: overrides.validBefore ?? BigInt(requirement.extra.validBefore),
    nonce: (overrides.nonce ?? requirement.extra.qid) as Hex,
  };
  const signature = await signer.signTypedData(
    receiveAuthorizationTypedData({
      tokenName: requirement.extra.tokenName,
      tokenVersion: requirement.extra.tokenVersion,
      asset: requirement.asset as Hex,
      authorization,
    }),
  );
  return encodeHeader({
    x402Version: 2,
    accepted: {
      scheme: 'escrow',
      network: FUJI_NETWORK,
      asset: requirement.asset,
      amount: overrides.acceptedAmount ?? requirement.amount,
      payTo: requirement.payTo,
      extra: { qid: requirement.extra.qid },
    },
    payload: {
      signature,
      authorization: {
        from: authorization.from, // checksummed on purpose: wallets send it that way
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  });
}

export function pay(test: TestApp, quote: PaymentRequired, header: string, question = QUESTION) {
  return test.api
    .post('/api/ask')
    .set('PAYMENT-SIGNATURE', header)
    .send({ question, qid: requirementOf(quote).extra.qid });
}

export function stageOf(test: TestApp, qid: string): string | undefined {
  const row = test.store.prepare('SELECT stage FROM questions WHERE qid = ?').get(qid) as
    { stage: string } | undefined;
  return row?.stage;
}

export function rowCount(test: TestApp): number {
  return Number(
    (test.store.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n,
  );
}

export function rowOf(test: TestApp, qid: string) {
  return test.store.prepare('SELECT * FROM questions WHERE qid = ?').get(qid) as
    Record<string, string | number | null> | undefined;
}

// A full ask: quote, sign, pay. Returns the final response and the qid.
export async function ask(test: TestApp, question = QUESTION) {
  const quote = await requestQuote(test, question);
  const qid = requirementOf(quote).extra.qid as Hex;
  const response = await pay(test, quote, await signPayment(quote), question);
  return { response, qid, quote };
}
