// Shared test setup: a real Express app on an in-memory SQLite, a fake chain at the payment.chain
// boundary (backend.md §8), and a payer that signs with a real viem account.
import { vi, type Mock } from 'vitest';
import supertest from 'supertest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/shared/logger.js';
import { openStore } from '../src/shared/store.js';
import type { PaymentChain } from '../src/modules/payment/payment.chain.js';
import {
  FUJI_NETWORK,
  encodeHeader,
  paymentRequiredSchema,
  receiveAuthorizationTypedData,
  type PaymentRequired,
} from '@askpay/shared/x402';

export const ESCROW = '0x869E95576f6dD6f06118CF733b4F307Ae37ddce0' as const;
export const TOKEN = '0x5425890298aed601595a70AB815c96711a31Bc65' as const;
export const PRICE = 50_000n;
export const QUESTION = 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?';
export const T0 = 1_762_699_400_000; // fixed clock, unix ms

export const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
export const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);
export const DEPOSIT_TX = `0x${'ab'.repeat(32)}` as Hex;

type MockedMethod = 'payerBalance' | 'providerCanPayGas' | 'questionStatus' | 'deposit';
export type FakeChain = Omit<PaymentChain, MockedMethod> & {
  [Method in MockedMethod]: Mock<PaymentChain[Method]>;
};

// Overrides are always vi.fn() in the tests, so the mock-typed result is accurate.
export function createFakeChain(overrides: Partial<PaymentChain> = {}): FakeChain {
  const chain = {
    escrow: ESCROW,
    token: TOKEN,
    tokenName: 'USD Coin',
    tokenVersion: '2',
    answerWindowSeconds: 600,
    payerBalance: vi.fn(async () => 10n * PRICE),
    providerCanPayGas: vi.fn(async () => true),
    questionStatus: vi.fn(async () => 'None' as const),
    deposit: vi.fn(async () => ({ kind: 'mined' as const, hash: DEPOSIT_TX, success: true })),
    ...overrides,
  } satisfies PaymentChain;
  return chain as FakeChain;
}

export interface TestOptions {
  chain?: ReturnType<typeof createFakeChain>;
  rateLimitPerMinute?: number;
  quoteTtlSeconds?: number;
}

export function createTestApp(options: TestOptions = {}) {
  const chain = options.chain ?? createFakeChain();
  const store = openStore(':memory:');
  const clock = { now: T0 };
  let salt = 0;
  const app = createApp({
    config: {
      priceUnits: PRICE,
      quoteTtlSeconds: options.quoteTtlSeconds ?? 300,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
    },
    store,
    chain,
    logger: createLogger('silent'),
    now: () => clock.now,
    randomSalt: () => `0x${(++salt).toString(16).padStart(32, '0')}`,
  });
  return { api: supertest(app), chain, store, clock };
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
