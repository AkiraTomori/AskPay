// POST /ask in two steps (api.md §3): quote, then payment. Paying deposits into escrow, then runs
// the pipeline (answer, check, settle) and holds the request up to REQUEST_WAIT_MS for the result.
// The pipeline does not depend on the request (system-design §5.6 rule 3): a client that leaves, or
// a 60-second wait that runs out, never cancels it.
import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, keccak256, toBytes, toHex, type Hex } from 'viem';
import type { AskAccepted, QuestionResult } from '@askpay/shared/api';
import {
  FUJI_NETWORK,
  decodeHeader,
  paymentPayloadSchema,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentResponse,
} from '@askpay/shared/x402';
import { AppError } from '../../shared/errors.js';
import { REQUEST_WAIT_MS, type Config } from '../../shared/config.js';
import type { CorpusService } from '../corpus/corpus.service.js';
import {
  buildPaymentRequired,
  ensurePayerCanPay,
  providerCanPayGas,
  readQuestionStatus,
  sendDeposit,
  txQueueHealthy,
  verifyPayment,
  type OnChainStatus,
  type Quote,
  type SendHooks,
} from '../payment/payment.service.js';
import type { AskContext } from './ask.context.js';
import type { Pipeline } from './ask.pipeline.js';
import {
  findQuestion,
  insertQuote,
  patchQuestion,
  transitionStage,
  type QuestionRow,
  type Stage,
} from './ask.repository.js';
import { toQuestionResult } from './ask.result.js';

export interface AskDeps {
  ctx: AskContext;
  pipeline: Pipeline;
  corpus: CorpusService;
  config: Pick<Config, 'priceUnits' | 'quoteTtlSeconds'>;
  requestWaitMs?: number; // injectable so tests need not wait a minute
  randomSalt?: () => Hex; // 16 bytes; injectable so tests get fixed qids
}

// 200 with the final result, or 202 with where the question stands (the client then polls).
export type PaymentAccepted =
  | { status: 200; body: QuestionResult; paymentResponse: PaymentResponse }
  | { status: 202; body: AskAccepted; paymentResponse: PaymentResponse };

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

export function createAskService(deps: AskDeps): AskService {
  const { ctx, pipeline, corpus, config } = deps;
  const { store, chain, logger, now } = ctx;
  const randomSalt = deps.randomSalt ?? (() => toHex(randomBytes(16)));
  const waitMs = deps.requestWaitMs ?? REQUEST_WAIT_MS;
  const resultOf = (row: QuestionRow) => toQuestionResult(row, corpus);

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
      throw new AppError('QUESTION_ALREADY_SETTLED', resultOf(row));
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
    // 4. Both wallets can cover it, and the tx queue is not stuck (a stuck queue could not settle
    //    what it takes). RPC trouble here is "not charged yet", so 503 is honest.
    try {
      if (!txQueueHealthy(chain) || !(await providerCanPayGas(chain))) {
        throw new AppError('CHAIN_UNAVAILABLE');
      }
      await ensurePayerCanPay(chain, payer, row.price);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.warn({ qid: row.qid }, 'chain read failed before deposit');
      throw new AppError('CHAIN_UNAVAILABLE');
    }
    // 5. Win the stage. Only the winner may send a deposit.
    if (!transitionStage(store, row.qid, 'QUOTED', 'DEPOSITING', now())) {
      const current = findQuestion(store, row.qid);
      throw new AppError('QUESTION_ALREADY_SETTLED', current ? resultOf(current) : undefined);
    }
    // Held for the whole deposit, so recovery does not reconcile a deposit that is in progress.
    ctx.inflight.add(row.qid);
    try {
      return await deposit(row, payer, payload);
    } finally {
      ctx.inflight.delete(row.qid);
    }
  }

  async function deposit(
    row: QuestionRow,
    payer: `0x${string}`,
    payload: PaymentPayload,
  ): Promise<PaymentAccepted> {
    const { authorization, signature } = payload.payload;
    // §5.6 C: the hash and nonce are stored before the tx is sent, so a crash at any point leaves
    // a row that recovery can resolve by nonce.
    const hooks: SendHooks = {
      onSigned: (tx) => {
        patchQuestion(store, row.qid, ['DEPOSITING'], now(), {
          pendingTx: tx.hash,
          pendingNonce: tx.nonce,
        });
      },
      // Only while nothing is held: with money already in, a second deposit would revert.
      shouldReplace: async () => (await readQuestionStatus(chain, row.qid)) === 'None',
    };
    const outcome = await sendDeposit(
      chain,
      {
        qid: row.qid,
        payer,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        signature,
      },
      hooks,
    );

    if (outcome.kind === 'mined' && outcome.success) {
      return deposited(row, payer, outcome.hash);
    }
    if (outcome.kind === 'unknown') {
      // AP-03-AC06: the tx may be on the network. Never answer 402, or the payer asks for a new
      // quote and pays twice. Stay DEPOSITING with pending_tx stored; recovery resolves it.
      logger.warn({ qid: row.qid }, 'deposit outcome unknown');
      return accepted(row.qid, 'DEPOSITING');
    }
    if (outcome.kind === 'not-sent' && outcome.rpcDown) {
      // Nothing was signed: the node could not be reached. The payer has not been charged and can
      // retry with the same signature while the quote lives.
      backToQuoted(row.qid);
      throw new AppError('CHAIN_UNAVAILABLE');
    }
    // Reverted or refused. A revert does not mean no money: only the chain can say.
    logger.warn(
      {
        qid: row.qid,
        kind: outcome.kind,
        ...(outcome.kind === 'not-sent'
          ? { reason: outcome.reason, errorName: outcome.errorName }
          : {}),
        ...(outcome.kind === 'mined' ? { tx: outcome.hash } : {}),
      },
      'deposit did not succeed; reading the chain to see whether money is held',
    );
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
      backToQuoted(row.qid);
      logger.info({ qid: row.qid }, 'deposit failed, nothing held; back to QUOTED');
      throw new AppError('PAYMENT_INVALID', { reason: 'DEPOSIT_FAILED' });
    }
    // Paid or Refunded cannot follow a deposit this process just made; recovery syncs it.
    logger.error({ qid: row.qid, status }, 'unexpected chain status after deposit');
    return accepted(row.qid, 'DEPOSITING');
  }

  // Nothing is held and nothing is pending: the same signature can be sent again while the quote lives.
  function backToQuoted(qid: Hex): void {
    transitionStage(store, qid, 'DEPOSITING', 'QUOTED', now(), {
      pendingTx: null,
      pendingNonce: null,
    });
  }

  // Money is in escrow: start the pipeline and hold the request for its result.
  async function deposited(
    row: QuestionRow,
    payer: `0x${string}`,
    hash: Hex | undefined,
  ): Promise<PaymentAccepted> {
    transitionStage(store, row.qid, 'DEPOSITING', 'ANSWERING', now(), {
      payer,
      pendingTx: null,
      pendingNonce: null,
      ...(hash ? { depositTx: hash } : {}),
    });
    logger.info({ qid: row.qid, tx: hash }, 'deposited');

    // Started now, not awaited: run() never rejects, and takes its own hold on the question before
    // its first await, so there is no gap in which recovery could pick it up.
    const pipelineDone = pipeline.run(row.qid);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    });
    await Promise.race([pipelineDone, timeout]);
    clearTimeout(timer);

    const current = findQuestion(store, row.qid);
    if (current && (current.stage === 'PAID' || current.stage === 'REFUNDED')) {
      return {
        status: 200,
        body: resultOf(current),
        paymentResponse: {
          success: true,
          network: FUJI_NETWORK,
          ...(current.depositTx ? { transaction: current.depositTx } : {}),
          ...(current.settleTx ? { settleTransaction: current.settleTx } : {}),
        },
      };
    }
    return accepted(row.qid, current?.stage ?? 'ANSWERING', hash);
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
