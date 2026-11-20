// One question through the x402 escrow flow: quote, guard, reserve, sign, pay, read the result.
// `fetch`, the signer and the clock are passed in, so the money rules run in tests with no network
// and no wallet. The only thing that can end a run early is a `stopped` outcome (g1-buyer-agent §4).
import {
  askRequestSchema,
  dataEnvelopeSchema,
  errorEnvelopeSchema,
  insufficientBalanceDetailsSchema,
  questionResultSchema,
  type QuestionResult,
} from '@askpay/shared/api';
import { formatUsdc, parseUnits } from '@askpay/shared/money';
import {
  ESCROW_SCHEME,
  FUJI_NETWORK,
  X402_VERSION,
  encodeHeader,
  paymentRequiredSchema,
  receiveAuthorizationTypedData,
  type PaymentRequired,
} from '@askpay/shared/x402';
import type { Budget } from './budget.js';
import { checkQuote, type Deployment } from './guard.js';

export interface AgentSigner {
  address: `0x${string}`;
  signTypedData(
    typedData: ReturnType<typeof receiveAuthorizationTypedData>,
  ): Promise<`0x${string}`>;
}

export interface ClientDeps {
  apiUrl: string;
  fetch: typeof fetch;
  signer: AgentSigner;
  budget: Budget;
  deployment: Deployment;
  now?: () => number; // milliseconds
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  rateLimitRetries?: number;
  rateLimitDelayMs?: number;
}

export type StopReason = 'GUARD' | 'BUDGET' | 'CHAIN' | 'RATE_LIMIT' | 'ERROR';

export type AskOutcome =
  // PAID or REFUNDED: the answer is final. A refund is a correct result, not an error.
  | { kind: 'settled'; qid: string; result: QuestionResult }
  // Money may be held but the result is not known (poll window over, CLAIMABLE). The reservation
  // stays, and the question is never paid a second time.
  | { kind: 'unresolved'; qid: string; note: string; result?: QuestionResult }
  // Nothing was signed or the server said no money moved. The run goes on.
  | { kind: 'skipped'; message: string }
  // The whole run ends here.
  | { kind: 'stopped'; reason: StopReason; message: string; price?: bigint };

// The pay request is held by the server for up to 60 seconds before it answers 202.
const QUOTE_TIMEOUT_MS = 30_000;
const PAY_TIMEOUT_MS = 90_000;
const POLL_REQUEST_TIMEOUT_MS = 15_000;
// answerWindow is 600 seconds; the extra minute covers the settle transaction.
const DEFAULT_POLL_TIMEOUT_MS = 11 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Reply {
  status: number;
  json: unknown;
  headers: Headers;
}

const stopped = (reason: StopReason, message: string, price?: bigint): AskOutcome =>
  price === undefined
    ? { kind: 'stopped', reason, message }
    : { kind: 'stopped', reason, message, price };

function errorCode(json: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(json);
  return parsed.success ? parsed.data.error : undefined;
}

// A result is final only when the money status says so.
function finalResult(json: unknown): QuestionResult | undefined {
  const parsed = dataEnvelopeSchema(questionResultSchema).safeParse(json);
  if (!parsed.success) return undefined;
  const status = parsed.data.data.status;
  return status === 'PAID' || status === 'REFUNDED' ? parsed.data.data : undefined;
}

export async function askAndPay(rawQuestion: string, deps: ClientDeps): Promise<AskOutcome> {
  const parsedQuestion = askRequestSchema.safeParse({ question: rawQuestion });
  if (!parsedQuestion.success) {
    return { kind: 'skipped', message: 'question is empty or longer than 500 characters' };
  }
  // The very same string goes into the quote and the payment, or the server answers QUESTION_MISMATCH.
  const question = parsedQuestion.data.question;

  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const base = deps.apiUrl.replace(/\/+$/, '');

  async function call(
    method: 'GET' | 'POST',
    path: string,
    timeoutMs: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const response = await deps.fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await response.json().catch(() => undefined);
    return { status: response.status, json, headers: response.headers };
  }

  // --- 1. Quote. Nothing is signed yet, so every failure here is safe. ---------------------
  let quote: PaymentRequired | undefined;
  const retries = deps.rateLimitRetries ?? 3;
  for (let attempt = 0; quote === undefined; attempt++) {
    let reply: Reply;
    try {
      reply = await call('POST', '/api/ask', QUOTE_TIMEOUT_MS, { question });
    } catch {
      return stopped('ERROR', 'could not get a quote from the API (network error or timeout)');
    }
    if (reply.status === 429) {
      if (attempt >= retries)
        return stopped('RATE_LIMIT', 'the API keeps answering 429 to quote requests');
      await sleep((deps.rateLimitDelayMs ?? 10_000) * (attempt + 1));
      continue;
    }
    if (reply.status === 402) {
      const parsed = paymentRequiredSchema.safeParse(reply.json);
      if (!parsed.success) {
        return stopped('GUARD', 'the quote is not an x402 v2 escrow quote on Avalanche Fuji');
      }
      quote = parsed.data;
    } else if (reply.status === 400) {
      return {
        kind: 'skipped',
        message: errorCode(reply.json)?.message ?? 'the API rejected the question',
      };
    } else if (reply.status === 503) {
      return stopped('CHAIN', 'the API cannot reach the blockchain right now');
    } else {
      return stopped('ERROR', `expected a 402 quote, got HTTP ${reply.status}`);
    }
  }
  const requirement = quote.accepts[0];
  if (!requirement) return stopped('GUARD', 'the quote has no payment option');

  // --- 2. Guard, then the budget. Both run before the key is used. -------------------------
  const guard = checkQuote(quote, deps.deployment, now() / 1000);
  if (!guard.ok) return stopped('GUARD', `quote refused, nothing signed: ${guard.reason}`);

  const price = parseUnits(requirement.amount);
  if (!deps.budget.reserve(price)) {
    return stopped(
      'BUDGET',
      `budget reached: ${formatUsdc(deps.budget.committed())} of ${formatUsdc(deps.budget.cap)} USDC committed, next question costs ${formatUsdc(price)}`,
      price,
    );
  }

  // --- 3. Sign. The reservation is already counted, so give it back if signing fails. ------
  const qid = requirement.extra.qid;
  // The quote schema guarantees lowercase 0x hex; it types them as plain strings.
  const hex = (value: string) => value as `0x${string}`;
  const authorization = {
    from: deps.signer.address,
    to: hex(requirement.payTo),
    value: price,
    validAfter: 0n,
    validBefore: parseUnits(requirement.extra.validBefore),
    nonce: hex(qid),
  };
  let signature: `0x${string}`;
  try {
    signature = await deps.signer.signTypedData(
      receiveAuthorizationTypedData({
        tokenName: requirement.extra.tokenName,
        tokenVersion: requirement.extra.tokenVersion,
        asset: hex(requirement.asset),
        authorization,
      }),
    );
  } catch {
    deps.budget.release(price);
    return stopped('ERROR', 'signing failed, nothing was sent');
  }
  const header = encodeHeader({
    x402Version: X402_VERSION,
    accepted: {
      scheme: ESCROW_SCHEME,
      network: FUJI_NETWORK,
      asset: requirement.asset,
      amount: requirement.amount,
      payTo: requirement.payTo,
      extra: { qid },
    },
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: '0',
        validBefore: authorization.validBefore.toString(),
        nonce: qid,
      },
    },
  });

  // --- 4. Pay. From here the money may be held: only an explicit "no tx" answer gives it back.
  let reply: Reply;
  for (let attempt = 0; ; attempt++) {
    try {
      reply = await call(
        'POST',
        '/api/ask',
        PAY_TIMEOUT_MS,
        { question, qid },
        { 'PAYMENT-SIGNATURE': header },
      );
    } catch {
      return poll(qid, 'the connection broke after the payment was sent');
    }
    // The API's own rate limiter runs before the payment is read, so this 429 changed nothing: the
    // quote is still QUOTED and the same signed request can be sent again. A 429 without the API's
    // error envelope (a proxy, say) is not trusted this way and falls through to polling below.
    if (reply.status !== 429 || errorCode(reply.json)?.code !== 'RATE_LIMITED') break;
    if (attempt >= retries) {
      deps.budget.release(price);
      return stopped(
        'RATE_LIMIT',
        'the API keeps answering 429 to the payment, no money moved; this question was not asked',
      );
    }
    await sleep((deps.rateLimitDelayMs ?? 10_000) * (attempt + 1));
  }
  const code = errorCode(reply.json);

  if (reply.status === 200) {
    const result = finalResult(reply.json);
    if (result) return { kind: 'settled', qid, result };
    return poll(qid, 'the 200 response could not be read');
  }
  if (reply.status === 409 && code?.code === 'QUESTION_ALREADY_SETTLED') {
    const result = finalResult({ data: code.details });
    if (result) return { kind: 'settled', qid, result };
    return poll(qid, 'the question was already paid but is not settled yet');
  }
  // The server says nothing was sent on-chain: give the reservation back.
  if (reply.status === 402 && code?.code === 'PAYMENT_INVALID') {
    deps.budget.release(price);
    const insufficient = insufficientBalanceDetailsSchema.safeParse(code.details);
    const reason = insufficient.success
      ? `the wallet cannot pay: balance ${formatUsdc(BigInt(insufficient.data.balance))}, price ${formatUsdc(BigInt(insufficient.data.price))} USDC (faucet: ${insufficient.data.faucetUrl})`
      : code.message;
    return { kind: 'skipped', message: `payment refused, no money moved: ${reason}` };
  }
  // QUESTION_MISMATCH is checked by the server before any deposit (and after the "already paid"
  // check), so it also means no money moved.
  if (
    (reply.status === 400 && code?.code === 'VALIDATION_FAILED') ||
    (reply.status === 404 && code?.code === 'QUESTION_NOT_FOUND') ||
    (reply.status === 409 && code?.code === 'QUESTION_MISMATCH')
  ) {
    deps.budget.release(price);
    return { kind: 'skipped', message: `payment refused, no money moved: ${code.message}` };
  }
  if (reply.status === 503 && code?.code === 'CHAIN_UNAVAILABLE') {
    deps.budget.release(price);
    return stopped(
      'CHAIN',
      'the API could not take the payment (blockchain unavailable), no money moved',
    );
  }
  // 202, and anything this table does not list: assume the money may be held and ask by qid.
  return poll(
    qid,
    reply.status === 202
      ? 'the answer is still being prepared'
      : `unexpected HTTP ${reply.status} after the payment was sent`,
  );

  // --- 5. Poll GET /questions/:qid until the money status is final. ------------------------
  async function poll(pollQid: string, why: string): Promise<AskOutcome> {
    const timeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const stopAt = now() + timeoutMs;
    let last: QuestionResult | undefined;
    for (;;) {
      try {
        const polled = await call('GET', `/api/questions/${pollQid}`, POLL_REQUEST_TIMEOUT_MS);
        const parsed = dataEnvelopeSchema(questionResultSchema).safeParse(polled.json);
        if (polled.status === 200 && parsed.success) {
          last = parsed.data.data;
          if (last.status === 'PAID' || last.status === 'REFUNDED') {
            return { kind: 'settled', qid: pollQid, result: last };
          }
          if (last.status === 'CLAIMABLE') {
            return {
              kind: 'unresolved',
              qid: pollQid,
              result: last,
              note: 'the answer deadline passed; the payer can claim the refund from the web app',
            };
          }
          if (last.stage === 'EXPIRED') {
            return {
              kind: 'unresolved',
              qid: pollQid,
              result: last,
              note: 'the quote lapsed on the server; check the question page',
            };
          }
        }
      } catch {
        // A failed poll is not a result. Try again until the window ends.
      }
      if (now() >= stopAt) break;
      await sleep(intervalMs);
    }
    return {
      kind: 'unresolved',
      qid: pollQid,
      note: `${why}; no final result after ${Math.round(timeoutMs / 60_000)} minutes. Money is treated as committed and the question is not asked again`,
      ...(last ? { result: last } : {}),
    };
  }
}
