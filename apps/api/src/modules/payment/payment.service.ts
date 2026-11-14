// Builds the x402 quote and verifies the payer's authorisation off-chain, before any gas is spent
// (system-design §4.2). It never sends a transaction; payment.chain does.
import { verifyTypedData, type Address } from 'viem';
import { FAUCET_URL, MIN_VALID_BEFORE_SECONDS } from '../../shared/config.js';
import { AppError } from '../../shared/errors.js';
import {
  ESCROW_SCHEME,
  FUJI_NETWORK,
  RECEIVE_AUTHORIZATION,
  X402_VERSION,
  receiveAuthorizationTypedData,
  type PaymentPayload,
  type PaymentRequired,
} from '@askpay/shared/x402';
import type { InsufficientBalanceDetails } from '@askpay/shared/api';
import type { DepositRequest, OnChainStatus, PaymentChain } from './payment.chain.js';

// Other modules reach payments only through this service (codebase.md §3), never payment.chain.
export type { DepositRequest, OnChainStatus, PaymentChain };
export type { TxOutcome } from '../../shared/tx-queue.js';

// What the quote promised; stored with the question, so the check never depends on today's config.
export interface Quote {
  qid: `0x${string}`;
  price: bigint;
  expiresAtSeconds: number;
}

export function buildPaymentRequired(chain: PaymentChain, quote: Quote): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: 'PAYMENT_REQUIRED',
    resource: {
      url: '/api/ask',
      description: 'Một câu trả lời có trích dẫn Bộ luật Lao động 2019',
    },
    accepts: [
      {
        scheme: ESCROW_SCHEME,
        network: FUJI_NETWORK,
        asset: chain.token.toLowerCase() as `0x${string}`,
        amount: quote.price.toString(),
        payTo: chain.escrow.toLowerCase() as `0x${string}`,
        maxTimeoutSeconds: 300,
        extra: {
          qid: quote.qid,
          authorization: RECEIVE_AUTHORIZATION,
          tokenName: chain.tokenName,
          tokenVersion: chain.tokenVersion,
          validBefore: String(quote.expiresAtSeconds),
          answerWindowSeconds: chain.answerWindowSeconds,
        },
      },
    ],
  };
}

function invalid(reason: string): never {
  throw new AppError('PAYMENT_INVALID', { reason });
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Throws PAYMENT_INVALID for anything that must not reach the chain (AP-03-AC02). Returns the payer.
export async function verifyPayment(input: {
  chain: PaymentChain;
  payload: PaymentPayload;
  quote: Quote;
  nowSeconds: number;
}): Promise<Address> {
  const { chain, payload, quote, nowSeconds } = input;
  const { accepted } = payload;
  const { authorization, signature } = payload.payload;

  // The client echoes the requirement it accepted; what decides where the money goes must match.
  if (accepted.network !== FUJI_NETWORK) invalid('WRONG_NETWORK');
  if (!same(accepted.asset, chain.token)) invalid('WRONG_ASSET');
  if (!same(accepted.payTo, chain.escrow)) invalid('WRONG_RECIPIENT');
  if (accepted.amount !== quote.price.toString()) invalid('WRONG_AMOUNT');
  if (accepted.extra.qid !== quote.qid) invalid('WRONG_QID');

  const value = BigInt(authorization.value);
  const validAfter = BigInt(authorization.validAfter);
  const validBefore = BigInt(authorization.validBefore);
  if (!same(authorization.to, chain.escrow)) invalid('WRONG_RECIPIENT');
  if (value !== quote.price) invalid('WRONG_AMOUNT');
  if (authorization.nonce !== quote.qid) invalid('WRONG_NONCE');
  if (validAfter > BigInt(nowSeconds)) invalid('NOT_YET_VALID');
  // Under a minute left, the tx could be mined after the authorisation expires and revert.
  if (validBefore < BigInt(nowSeconds + MIN_VALID_BEFORE_SECONDS)) invalid('EXPIRED');
  // A longer window than the quote offered would outlive the quote.
  if (validBefore > BigInt(quote.expiresAtSeconds)) invalid('WINDOW_TOO_LONG');

  const typedData = receiveAuthorizationTypedData({
    tokenName: chain.tokenName,
    tokenVersion: chain.tokenVersion,
    asset: chain.token,
    authorization: {
      from: authorization.from,
      to: authorization.to,
      value,
      validAfter,
      validBefore,
      nonce: authorization.nonce,
    },
  });
  const valid = await verifyTypedData({
    ...typedData,
    address: authorization.from,
    signature,
  }).catch(() => false);
  if (!valid) invalid('BAD_SIGNATURE');

  return authorization.from;
}

// AP-03-AC05: tell the payer what is missing instead of letting the token revert on-chain.
export async function ensurePayerCanPay(
  chain: PaymentChain,
  payer: Address,
  price: bigint,
): Promise<void> {
  const balance = await chain.payerBalance(payer);
  if (balance >= price) return;
  const details: InsufficientBalanceDetails = {
    reason: 'INSUFFICIENT_BALANCE',
    balance: balance.toString(),
    price: price.toString(),
    faucetUrl: FAUCET_URL,
  };
  throw new AppError('PAYMENT_INVALID', details);
}

// Thin on purpose: they keep `payment.chain` an implementation detail of this module.
export const providerCanPayGas = (chain: PaymentChain): Promise<boolean> =>
  chain.providerCanPayGas();

export const readQuestionStatus = (
  chain: PaymentChain,
  qid: `0x${string}`,
): Promise<OnChainStatus> => chain.questionStatus(qid);

export const sendDeposit = (chain: PaymentChain, request: DepositRequest) => chain.deposit(request);
