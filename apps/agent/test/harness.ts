// A fake AskPay API and a counting signer: the agent's money rules run with no network, no wallet.
import { fujiDeployment } from '@askpay/shared/abi';
import { FUJI_NETWORK, type PaymentRequired } from '@askpay/shared/x402';
import { privateKeyToAccount } from 'viem/accounts';
import { createBudget, type Budget } from '../src/budget.js';
import type { AgentSigner, ClientDeps } from '../src/client.js';

export const NOW_MS = 1_800_000_000_000;
export const PRICE = 50_000n; // 0.05 USDC
export const TEST_KEY = `0x${'11'.repeat(32)}` as const;
export const account = privateKeyToAccount(TEST_KEY);

export const qidOf = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

export interface Call {
  method: string;
  path: string;
  body: { question?: string; qid?: string } | undefined;
  paymentSignature: string | undefined;
}

export interface Reply {
  status: number;
  json?: unknown;
}

export type Handler = (call: Call, state: { quotes: number; pays: number }) => Reply;

export function quote(overrides: Record<string, unknown> = {}, n = 1): PaymentRequired {
  return {
    x402Version: 2,
    error: 'PAYMENT_REQUIRED',
    resource: { url: '/api/ask', description: 'test' },
    accepts: [
      {
        scheme: 'escrow',
        network: FUJI_NETWORK,
        asset: fujiDeployment.token.toLowerCase(),
        amount: PRICE.toString(),
        payTo: fujiDeployment.address.toLowerCase(),
        maxTimeoutSeconds: 300,
        extra: {
          qid: qidOf(n),
          authorization: 'ReceiveWithAuthorization',
          tokenName: 'USD Coin',
          tokenVersion: '2',
          validBefore: String(Math.floor(NOW_MS / 1000) + 300),
          answerWindowSeconds: 600,
        },
        ...overrides,
      },
    ],
  } as PaymentRequired;
}

export const result = (qid: string, extra: Record<string, unknown> = {}) => ({
  data: {
    qid,
    question: 'q',
    stage: 'PAID',
    status: 'PAID',
    amount: PRICE.toString(),
    answer: 'Trả lời mẫu',
    citations: [
      {
        lawId: qidOf(1),
        dieu: 25,
        khoan: 2,
        dieuTitle: 'Thử việc',
        quote: 'q',
        text: 't',
        textHash: qidOf(2),
        quoteHash: qidOf(3),
        verifiedOnChain: true,
      },
    ],
    tx: { deposit: qidOf(7), settle: qidOf(8) },
    ...extra,
  },
});

export const apiError = (status: number, code: string, details?: unknown): Reply => ({
  status,
  json: {
    error: { code, message: `${code} message`, ...(details === undefined ? {} : { details }) },
  },
});

// The usual script: every question gets a fresh quote, every payment settles as PAID.
export function happyHandler(payStatus: 'PAID' | 'REFUNDED' = 'PAID'): Handler {
  return (call, state) => {
    if (call.method === 'GET') return { status: 404 };
    if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
    return {
      status: 200,
      json: result(call.body?.qid ?? '', {
        status: payStatus,
        stage: payStatus,
        ...(payStatus === 'REFUNDED' ? { reason: 'CHECKER_REJECTED' } : {}),
      }),
    };
  };
}

export function fakeApi(handler: Handler) {
  const calls: Call[] = [];
  const state = { quotes: 0, pays: 0 };
  const fetchFake = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      paymentSignature: headers.get('payment-signature') ?? undefined,
    };
    if (call.method === 'POST') {
      if (call.paymentSignature) state.pays++;
      else state.quotes++;
    }
    calls.push(call);
    const reply = handler(call, state);
    if (reply.status === -1) throw new TypeError('fetch failed');
    return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
      status: reply.status,
    });
  };
  return {
    fetch: fetchFake as typeof fetch,
    calls,
    state,
    quoteCalls: () => calls.filter((c) => c.method === 'POST' && !c.paymentSignature),
    payCalls: () => calls.filter((c) => c.method === 'POST' && c.paymentSignature),
  };
}

export const NETWORK_ERROR: Reply = { status: -1 };

export function countingSigner() {
  const calls: unknown[] = [];
  const signer: AgentSigner = {
    address: account.address,
    signTypedData: (typedData) => {
      calls.push(typedData);
      return account.signTypedData(typedData);
    },
  };
  return { signer, calls };
}

// A clock that only moves when the code sleeps, so polling loops finish instantly.
export function fakeClock() {
  let now = NOW_MS;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

export function clientDeps(
  api: ReturnType<typeof fakeApi>,
  options: { cap?: bigint; signer?: AgentSigner; budget?: Budget } & Partial<ClientDeps> = {},
): ClientDeps & { budget: Budget } {
  const { cap, signer, budget, ...rest } = options;
  const clock = fakeClock();
  return {
    apiUrl: 'http://api.test',
    fetch: api.fetch,
    signer: signer ?? countingSigner().signer,
    budget: budget ?? createBudget(cap ?? PRICE * 10n),
    deployment: fujiDeployment,
    now: clock.now,
    sleep: clock.sleep,
    ...rest,
  };
}
