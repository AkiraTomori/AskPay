// The only file that talks to AskPayEscrow and the token for payments (backend.md §2). It decides
// nothing: payment.service and ask.service use what it reads.
import { parseAbi, parseEventLogs, parseSignature, type Address, type Hex, type Log } from 'viem';
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import type { RefundReasonCode } from '@askpay/shared/errors';
import type { Citation } from '@askpay/shared/leaf';
import type { ChainClients } from '../../shared/chain.js';
import type {
  CallSource,
  ContractCall,
  SendHooks,
  TxOutcome,
  TxQueue,
} from '../../shared/tx-queue.js';

export type OnChainStatus = 'None' | 'Open' | 'Paid' | 'Refunded';
const STATUSES: readonly OnChainStatus[] = ['None', 'Open', 'Paid', 'Refunded'];

// Same order as `enum RefundReason` in AskPayEscrow.sol; a test reads the Solidity source to keep
// them equal. Index 0 (None) never appears in a Refunded event.
export const REFUND_REASON_BY_INDEX: readonly (RefundReasonCode | 'NONE')[] = [
  'NONE',
  'NO_CITATION',
  'INVALID_CITATION',
  'CHECKER_REJECTED',
  'ANSWER_FAILED',
  'TIMEOUT',
];

// Gas the provider wallet must be able to pay for one question: a deposit now and a settle later.
// Generous on purpose; Fuji fees are tiny, and refusing early costs nothing (AP-03-AC07).
const GAS_BUDGET_PER_QUESTION = 700_000n;
const FEE_SAFETY_FACTOR = 2n;

const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);

export interface DepositRequest {
  qid: Hex;
  payer: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  signature: Hex;
}

export interface ChainQuestion {
  status: OnChainStatus;
  // Unix seconds. The contract compares it with block.timestamp, so "time left" is measured
  // against the latest block, never the server clock (system-design §5.6 B).
  deadline: number;
}

// What the chain says happened, read from the receipt's logs (P2). A succeeded tx is not an event.
export type SettleEvent =
  | { name: 'Paid'; answerHash: Hex; citationsHash: Hex }
  | { name: 'Refunded'; reason: RefundReasonCode };

export interface SettleRequest {
  qid: Hex;
  answerHash: Hex;
  citations: readonly Citation[];
  proofs: readonly (readonly Hex[])[];
  pass: boolean;
  checkerSig: Hex;
}

// `mined` outcomes of settle/refund carry the decoded event; the rest are plain outcomes.
export type SettleResult = TxOutcome & { event?: SettleEvent };

// Which function to sign, asked again before every signing (§5.6 B, the cutoff rule).
export type Choice = 'settle' | 'refund';

// One escrow log as the indexer stores it (system-design §7). `args` holds strings only: bigints as
// decimal text, addresses lower-case, a Refunded reason as its code (RefundReasonCode).
export interface ChainEvent {
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
  name: 'LawRootSet' | 'Deposited' | 'Paid' | 'Refunded';
  qid: Hex | null;
  args: Record<string, string>;
}

export interface PaymentChain {
  readonly escrow: Address;
  readonly token: Address;
  readonly tokenName: string;
  readonly tokenVersion: string;
  readonly answerWindowSeconds: number;
  payerBalance(payer: Address): Promise<bigint>;
  providerCanPayGas(): Promise<boolean>;
  question(qid: Hex): Promise<ChainQuestion>;
  latestBlockTimestamp(): Promise<number>;
  // False once the tx queue is stuck: deposits are refused with 503 (§5.6 C).
  txHealthy(): boolean;
  deposit(request: DepositRequest, hooks?: SendHooks): Promise<TxOutcome>;
  settle(
    request: SettleRequest,
    choose: () => Promise<Choice>,
    hooks?: SendHooks,
  ): Promise<SettleResult>;
  refund(qid: Hex, hooks?: SendHooks): Promise<SettleResult>;
  // Restart recovery (§5.6 D): resolve a stored pending tx by its nonce.
  nonceState(): Promise<{ latest: number; pending: number }>;
  receiptOf(hash: Hex, qid: Hex): Promise<{ success: boolean; event?: SettleEvent } | undefined>;
  pendingFees(
    hash: Hex,
  ): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined>;
  // Every LawRootSet, Deposited, Paid and Refunded log in a block range: ONE RPC call, because the
  // public RPC limits both the range and the rate (T-09).
  eventsBetween(from: bigint, to: bigint): Promise<ChainEvent[]>;
  latestBlock(): Promise<bigint>;
  // The root the escrow holds for a law, for /corpus (AP-01-AC04).
  lawRootOf(lawId: Hex): Promise<Hex>;
  // Provider wallet balance in wei, for /health.
  providerBalance(): Promise<bigint>;
}

// What the server needs to be true about the deployment before it takes any money.
export interface DeploymentExpectations {
  // The address of CHECKER_PRIVATE_KEY.
  checker: Address;
  lawId: Hex;
  // The root rebuilt from the corpus file. If the chain disagrees, every settle would refund as
  // INVALID_CITATION and no unit test would notice.
  lawRoot: Hex;
}

// Reads the token domain and the escrow settings once, and refuses to start if this process holds
// the wrong key: deposit reverts with NotProvider otherwise, only after a payer has signed.
export async function createPaymentChain(
  clients: ChainClients,
  txQueue: TxQueue,
  expect: DeploymentExpectations,
): Promise<PaymentChain> {
  const { publicClient, account } = clients;
  const escrow = fujiDeployment.address as Address;
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({
      address: escrow,
      abi: askPayEscrowAbi,
      functionName,
      args,
    } as never) as Promise<T>;

  const [token, provider, checker, answerWindow, lawRoot] = await Promise.all([
    read<Address>('token'),
    read<Address>('provider'),
    read<Address>('checker'),
    read<bigint>('answerWindow'),
    read<Hex>('lawRoot', [expect.lawId]),
  ]);
  if (provider.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('PROVIDER_PRIVATE_KEY does not belong to the escrow provider');
  }
  // The on-chain checker, not fuji.json: a later setChecker would leave the file stale, and a
  // verdict signed by any other key makes every settle revert InvalidCheckerSignature.
  if (checker.toLowerCase() !== expect.checker.toLowerCase()) {
    throw new Error('CHECKER_PRIVATE_KEY does not belong to the escrow checker');
  }
  if (lawRoot.toLowerCase() !== expect.lawRoot.toLowerCase()) {
    throw new Error('The corpus root does not match the root registered on-chain');
  }
  const [tokenName, tokenVersion] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'version' }),
  ]);

  return {
    escrow,
    token,
    tokenName,
    tokenVersion,
    answerWindowSeconds: Number(answerWindow),

    payerBalance: (payer) =>
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [payer],
      }),

    async providerCanPayGas() {
      const [balance, fees] = await Promise.all([
        publicClient.getBalance({ address: account.address }),
        publicClient.estimateFeesPerGas(),
      ]);
      const feePerGas = fees.maxFeePerGas ?? (await publicClient.getGasPrice());
      return balance >= feePerGas * GAS_BUDGET_PER_QUESTION * FEE_SAFETY_FACTOR;
    },

    async question(qid) {
      const [, , deadline, status] = await read<readonly [Address, bigint, bigint, number]>(
        'questions',
        [qid],
      );
      const name = STATUSES[status];
      if (!name) throw new Error(`unknown question status ${status}`);
      return { status: name, deadline: Number(deadline) };
    },

    async latestBlockTimestamp() {
      const block = await publicClient.getBlock({ blockTag: 'latest' });
      return Number(block.timestamp);
    },

    txHealthy: () => txQueue.isHealthy(),

    deposit(request, hooks) {
      const { v, r, s, yParity } = parseSignature(request.signature);
      return txQueue.send(
        call('deposit', [
          request.qid,
          request.payer,
          request.value,
          request.validAfter,
          request.validBefore,
          Number(v ?? BigInt(27 + yParity)),
          r,
          s,
        ]),
        hooks,
      );
    },

    async settle(request, choose, hooks) {
      const source: CallSource = async () =>
        (await choose()) === 'settle'
          ? call('settle', [
              request.qid,
              request.answerHash,
              request.citations.map(toTuple),
              request.proofs,
              request.pass,
              request.checkerSig,
            ])
          : call('refundByProvider', [request.qid]);
      return withEvent(await txQueue.send(source, hooks), request.qid);
    },

    async refund(qid, hooks) {
      return withEvent(await txQueue.send(call('refundByProvider', [qid]), hooks), qid);
    },

    async nonceState() {
      const [latest, pending] = await Promise.all([
        publicClient.getTransactionCount({ address: account.address, blockTag: 'latest' }),
        publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      ]);
      return { latest, pending };
    },

    async receiptOf(hash, qid) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        const event = decodeEvent(receipt.logs, escrow, qid);
        return { success: receipt.status === 'success', ...(event ? { event } : {}) };
      } catch (error) {
        // viem throws when there is no receipt (yet); anything else is a real RPC failure.
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') {
          return undefined;
        }
        throw error;
      }
    },

    async pendingFees(hash) {
      try {
        const tx = await publicClient.getTransaction({ hash });
        return {
          ...(tx.maxFeePerGas !== undefined ? { maxFeePerGas: tx.maxFeePerGas } : {}),
          ...(tx.maxPriorityFeePerGas !== undefined
            ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas }
            : {}),
        };
      } catch {
        return undefined;
      }
    },

    async eventsBetween(from, to) {
      const logs = await publicClient.getContractEvents({
        address: escrow,
        abi: askPayEscrowAbi,
        fromBlock: from,
        toBlock: to,
      });
      return logs.flatMap((log) => toChainEvent(log) ?? []);
    },

    latestBlock: () => publicClient.getBlockNumber(),

    lawRootOf: (lawId) => read<Hex>('lawRoot', [lawId]),

    providerBalance: () => publicClient.getBalance({ address: account.address }),
  };

  function call(functionName: string, args: readonly unknown[]): ContractCall {
    return { abi: askPayEscrowAbi, address: escrow, functionName, args };
  }

  function withEvent(outcome: TxOutcome, qid: Hex): SettleResult {
    if (outcome.kind !== 'mined' || !outcome.success) return outcome;
    const event = decodeEvent(outcome.logs, escrow, qid);
    return event ? { ...outcome, event } : outcome;
  }
}

// Solidity `struct Citation` as a tuple, field for field.
function toTuple(citation: Citation) {
  return {
    lawId: citation.lawId,
    dieu: citation.dieu,
    khoan: citation.khoan,
    textHash: citation.textHash,
    quoteHash: citation.quoteHash,
  };
}

// Only a Paid or Refunded log emitted BY THE ESCROW for THIS qid counts (P2): another contract's
// log, or another question's, must not settle this one.
function decodeEvent(logs: readonly Log[], escrow: Address, qid: Hex): SettleEvent | undefined {
  const parsed = parseEventLogs({
    abi: askPayEscrowAbi,
    eventName: ['Paid', 'Refunded'],
    logs: logs as Log[],
    strict: false,
  });
  for (const log of parsed) {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    if (log.args.qid?.toLowerCase() !== qid.toLowerCase()) continue;
    if (log.eventName === 'Paid' && log.args.answerHash && log.args.citationsHash) {
      return {
        name: 'Paid',
        answerHash: log.args.answerHash,
        citationsHash: log.args.citationsHash,
      };
    }
    if (log.eventName === 'Refunded' && log.args.reason !== undefined) {
      const reason = REFUND_REASON_BY_INDEX[Number(log.args.reason)];
      if (reason && reason !== 'NONE') return { name: 'Refunded', reason };
    }
  }
  return undefined;
}

// The four events the indexer keeps. Config events (ProviderSet, ...) and logs still pending are
// left out: nothing reads them, and a pending log has no tx hash to key it by.
function toChainEvent(log: Log & { eventName?: string; args?: unknown }): ChainEvent | undefined {
  const { transactionHash, logIndex, blockNumber } = log;
  if (transactionHash === null || logIndex === null || blockNumber === null) return undefined;
  const args = (log.args ?? {}) as Record<string, unknown>;
  const text = (key: string) => String(args[key]).toLowerCase();
  const at = { txHash: transactionHash, logIndex, blockNumber: Number(blockNumber) };
  switch (log.eventName) {
    case 'Deposited':
      return {
        ...at,
        name: 'Deposited',
        qid: text('qid') as Hex,
        args: { payer: text('payer'), amount: text('amount'), deadline: text('deadline') },
      };
    case 'Paid':
      return {
        ...at,
        name: 'Paid',
        qid: text('qid') as Hex,
        args: {
          provider: text('provider'),
          amount: text('amount'),
          answerHash: text('answerHash'),
          citationsHash: text('citationsHash'),
        },
      };
    case 'Refunded':
      return {
        ...at,
        name: 'Refunded',
        qid: text('qid') as Hex,
        args: {
          payer: text('payer'),
          amount: text('amount'),
          reason: REFUND_REASON_BY_INDEX[Number(args.reason)] ?? 'UNKNOWN',
        },
      };
    case 'LawRootSet':
      return {
        ...at,
        name: 'LawRootSet',
        qid: null,
        args: { lawId: text('lawId'), root: text('root') },
      };
    default:
      return undefined;
  }
}
