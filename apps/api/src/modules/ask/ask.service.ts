// POST /ask in two steps (api.md §3): quote, then payment. A4 stops once the deposit is on-chain;
// answering, checking and settling are A5, so a deposited question waits at ANSWERING.
import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, keccak256, toBytes, toHex, type Hex } from 'viem';
import type { QuestionResult } from '@askpay/shared/api';
import {
  FUJI_NETWORK,
  decodeHeader,
  paymentPayloadSchema,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentResponse,
} from '@askpay/shared/x402';
import { AppError } from '../../shared/errors.js';
import type { Config } from '../../shared/config.js';
import type { Logger } from '../../shared/logger.js';
import type { Store } from '../../shared/store.js';
import {
  buildPaymentRequired,
  ensurePayerCanPay,
  providerCanPayGas,
  readQuestionStatus,
  sendDeposit,
  verifyPayment,
  type OnChainStatus,
  type PaymentChain,
  type Quote,
} from '../payment/payment.service.js';
import {
  findQuestion,
  insertQuote,
  transitionStage,
  type QuestionRow,
  type Stage,
} from './ask.repository.js';

export interface AskDeps {
  store: Store;
  chain: PaymentChain;
  config: Pick<Config, 'priceUnits' | 'quoteTtlSeconds'>;
  logger: Logger;
  now?: () => number; // unix ms; injectable so tests control expiry
  randomSalt?: () => Hex; // 16 bytes; injectable so tests get fixed qids
}

export interface PaymentAccepted {
  status: 202;
  body: { qid: Hex; stage: Stage };
  paymentResponse: PaymentResponse;
}

export interface AskService {
  requestQuote(question: string): PaymentRequired;
  submitPayment(input: {
    question: string;
    qid: Hex;
    paymentHeader: string | undefined;
  }): Promise<PaymentAccepted>;
}

// system-design §4.2: qid = keccak256(abi.encode(keccak256(utf8(question)), salt16)).
export function deriveQid(questionHash: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes16' }], [questionHash, salt]),
  );
}

// What an API caller may see of a question at this point in its life.
export function toQuestionResult(row: QuestionRow): QuestionResult {
  const started = row.stage !== 'QUOTED' && row.stage !== 'EXPIRED';
  return {
    qid: row.qid,
    question: row.question,
    stage: row.stage,
    ...(started ? { status: 'PENDING' as const, amount: row.price.toString() } : {}),
    ...(row.payer ? { payer: row.payer } : {}),
    ...(row.depositTx ? { tx: { deposit: row.depositTx } } : {}),
    createdAt: row.createdAt,
  };
}

export function createAskService(deps: AskDeps): AskService {
  const { store, chain, config, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const randomSalt = deps.randomSalt ?? (() => toHex(randomBytes(16)));

  function requestQuote(question: string): PaymentRequired {
    const questionHash = keccak256(toBytes(question));
    const qid = deriveQid(questionHash, randomSalt());
    const createdAt = now();
    const quoteExpiresAt = createdAt + config.quoteTtlSeconds * 1000;
    insertQuote(
      store,
      { qid, question, questionHash, price: config.priceUnits, quoteExpiresAt },
      createdAt,
    );
    logger.info({ qid, length: question.length }, 'quoted');
    return buildPaymentRequired(chain, quoteOf(qid, config.priceUnits, quoteExpiresAt));
  }

  async function submitPayment(input: {
    question: string;
    qid: Hex;
    paymentHeader: string | undefined;
  }): Promise<PaymentAccepted> {
    const payload = decodeHeader(paymentPayloadSchema, input.paymentHeader);
    if (!payload) throw new AppError('PAYMENT_INVALID', { reason: 'MALFORMED_HEADER' });

    // 1. The quote must exist, be unspent and unexpired.
    const row = findQuestion(store, input.qid);
    if (!row) throw new AppError('QUESTION_NOT_FOUND');
    if (row.stage === 'EXPIRED') throw new AppError('QUESTION_NOT_FOUND');
    if (row.stage !== 'QUOTED') {
      // A replay or a parallel twin: no second deposit, and the caller sees where it stands.
      throw new AppError('QUESTION_ALREADY_SETTLED', toQuestionResult(row));
    }
    if (now() >= row.quoteExpiresAt) {
      transitionStage(store, row.qid, 'QUOTED', 'EXPIRED', now());
      throw new AppError('QUESTION_NOT_FOUND');
    }
    // 2. Same question as the quote (AP-03-AC04), compared by hash.
    if (keccak256(toBytes(input.question)) !== row.questionHash) {
      throw new AppError('QUESTION_MISMATCH');
    }
    // 3. Signature and fields, off-chain. Nothing has been sent yet.
    const payer = await verifyPayment({
      chain,
      payload,
      quote: quoteOf(row.qid, row.price, row.quoteExpiresAt),
      nowSeconds: Math.floor(now() / 1000),
    });
    // 4. Both wallets can cover it. RPC trouble here is "not charged yet", so 503 is honest.
    try {
      if (!(await providerCanPayGas(chain))) throw new AppError('CHAIN_UNAVAILABLE');
      await ensurePayerCanPay(chain, payer, row.price);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.warn({ qid: row.qid }, 'chain read failed before deposit');
      throw new AppError('CHAIN_UNAVAILABLE');
    }
    // 5. Win the stage. Only the winner may send a deposit.
    if (!transitionStage(store, row.qid, 'QUOTED', 'DEPOSITING', now())) {
      const current = findQuestion(store, row.qid);
      throw new AppError(
        'QUESTION_ALREADY_SETTLED',
        current ? toQuestionResult(current) : undefined,
      );
    }
    return deposit(row, payer, payload);
  }

  async function deposit(
    row: QuestionRow,
    payer: `0x${string}`,
    payload: PaymentPayload,
  ): Promise<PaymentAccepted> {
    const { authorization, signature } = payload.payload;
    const outcome = await sendDeposit(chain, {
      qid: row.qid,
      payer,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      signature,
    });

    if (outcome.kind === 'mined' && outcome.success) {
      return deposited(row, payer, outcome.hash);
    }
    if (outcome.kind === 'unknown') {
      // AP-03-AC06: the tx may be on the network. Never answer 402, or the payer asks for a new
      // quote and pays twice. Stay DEPOSITING; A5 reconciles it against the chain.
      logger.warn({ qid: row.qid }, 'deposit outcome unknown');
      return accepted(row.qid, 'DEPOSITING');
    }
    // Reverted or never sent. A revert does not mean no money: only the chain can say.
    let status: OnChainStatus;
    try {
      status = await readQuestionStatus(chain, row.qid);
    } catch {
      logger.warn({ qid: row.qid }, 'chain status unreadable after failed deposit');
      return accepted(row.qid, 'DEPOSITING');
    }
    // Money is held, but not by a tx of ours that succeeded: do not record a reverted hash as the deposit.
    if (status === 'Open') return deposited(row, payer, undefined);
    if (status === 'None') {
      transitionStage(store, row.qid, 'DEPOSITING', 'QUOTED', now());
      logger.info({ qid: row.qid }, 'deposit failed, nothing held; back to QUOTED');
      throw new AppError('PAYMENT_INVALID', { reason: 'DEPOSIT_FAILED' });
    }
    // Paid or Refunded cannot follow a deposit this process just made; leave it for A5 to settle.
    logger.error({ qid: row.qid, status }, 'unexpected chain status after deposit');
    return accepted(row.qid, 'DEPOSITING');
  }

  function deposited(
    row: QuestionRow,
    payer: `0x${string}`,
    hash: Hex | undefined,
  ): PaymentAccepted {
    transitionStage(store, row.qid, 'DEPOSITING', 'ANSWERING', now(), {
      payer,
      ...(hash ? { depositTx: hash } : {}),
    });
    logger.info({ qid: row.qid, tx: hash }, 'deposited');
    return accepted(row.qid, 'ANSWERING', hash);
  }

  function accepted(qid: Hex, stage: Stage, hash?: Hex): PaymentAccepted {
    return {
      status: 202,
      body: { qid, stage },
      paymentResponse: {
        success: stage !== 'DEPOSITING',
        network: FUJI_NETWORK,
        ...(hash ? { transaction: hash } : {}),
      },
    };
  }

  return { requestQuote, submitPayment };
}

function quoteOf(qid: Hex, price: bigint, quoteExpiresAt: number): Quote {
  return { qid, price, expiresAtSeconds: Math.floor(quoteExpiresAt / 1000) };
}
