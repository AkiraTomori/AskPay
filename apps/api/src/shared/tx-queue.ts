// Sends provider-wallet transactions one at a time (T-10), so two requests never race for a nonce.
// This is system-design §5.6 C:
//   1. simulate (a revert here costs no gas and names its reason),
//   2. hand out a nonce only now that the tx will surely be sent,
//   3. sign locally, so the hash is known BEFORE the tx can reach the network,
//   4. let the caller persist that hash and nonce (onSigned), and only then send,
//   5. wait for the receipt; if none comes, send ONE replacement with the same nonce and a higher
//      fee, then give up and report the queue unhealthy.
//
// What a caller must know is whether money may have moved, so the result says it plainly:
//   mined     a receipt exists (success or revert)
//   not-sent  nothing reached the network (simulation reverted, or the node refused the tx)
//   unknown   the tx may be on the network but there is no receipt yet; never treat it as failed
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  FeeCapTooLowError,
  InsufficientFundsError,
  IntrinsicGasTooHighError,
  IntrinsicGasTooLowError,
  NonceTooHighError,
  NonceTooLowError,
  TipAboveFeeCapError,
  TransactionTypeNotSupportedError,
  encodeFunctionData,
  keccak256,
  type Abi,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';
import type { ChainClients } from './chain.js';

export const RECEIPT_TIMEOUT_MS = 30_000;
// Nodes refuse a replacement that does not raise both fee fields by about 10%; 20% is the design.
const REPLACEMENT_FEE_NUMERATOR = 12n;
const REPLACEMENT_FEE_DENOMINATOR = 10n;

export type TxOutcome =
  // `logs` are the receipt's logs: the caller reads Paid or Refunded from them (P2), never from the
  // fact that the tx succeeded.
  | { kind: 'mined'; hash: Hex; success: boolean; logs: readonly Log[] }
  // `errorName` is the contract's custom error when the simulation reverted with one
  // (QuestionNotOpen, InvalidCheckerSignature, ...). Callers branch on it, never on the message.
  // `rpcDown`: it failed before anything was signed and NOT because the contract reverted (the node
  // was unreachable or erred), so nothing is out there and the caller may say "you were not charged".
  | { kind: 'not-sent'; reason: string; errorName?: string; rpcDown?: boolean }
  // `stuck`: a replacement was sent too and neither has a receipt. The queue is unhealthy.
  | { kind: 'unknown'; hash?: Hex; stuck?: boolean };

export interface ContractCall {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args: readonly unknown[];
}

export type Attempt = 'first' | 'replacement';
// A function is asked again for the replacement, so a settle can become a refund when the cutoff
// has passed in the meantime (§5.6 B).
export type CallSource = ContractCall | ((attempt: Attempt) => Promise<ContractCall>);

export interface SignedTx {
  hash: Hex;
  nonce: number;
  replacement: boolean;
}

export interface SendHooks {
  // Runs after signing and BEFORE sending. Persist pending_tx and pending_nonce here (and the
  // stage change that goes with the tx), so a tx that reached the network always has a row.
  onSigned?: (tx: SignedTx) => void;
  // Runs when no receipt arrived in time. Resolve true if the question is still open on-chain
  // (rule 1), which makes a replacement worth sending. Without it nothing is replaced.
  shouldReplace?: () => Promise<boolean>;
  // Restart recovery (§5.6 D): a tx from before the restart is still in the mempool past its time.
  // Send the call as a replacement of THAT nonce; `fees` are the old tx's, which get the +20%.
  replace?: { nonce: number; fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } };
}

export interface TxQueue {
  send(call: CallSource, hooks?: SendHooks): Promise<TxOutcome>;
  // False once a replacement also stuck: deposits are refused until a later tx is mined.
  isHealthy(): boolean;
}

interface Fees {
  maxFeePerGas?: bigint | undefined;
  maxPriorityFeePerGas?: bigint | undefined;
  gasPrice?: bigint | undefined;
}
type Prepared = Fees & { nonce: number; [key: string]: unknown };

export function createTxQueue(
  clients: ChainClients,
  options: { receiptTimeoutMs?: number } = {},
): TxQueue {
  const { publicClient, walletClient, account } = clients;
  const receiptTimeout = options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS;
  // In memory, started from the pending count; resynced after any refused or doubtful send.
  let nextNonce: number | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let healthy = true;

  async function sign(call: ContractCall, nonce: number, bump?: Fees) {
    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    } as never);
    const prepared = (await walletClient.prepareTransactionRequest({
      account,
      to: call.address,
      data,
      nonce,
      ...(bump ? bumpedFees(bump) : {}),
    } as never)) as unknown as Prepared;
    const serialized = (await walletClient.signTransaction(prepared as never)) as Hex;
    return { prepared, serialized, hash: keccak256(serialized) };
  }

  async function waitFor(hashes: readonly Hex[]): Promise<TransactionReceipt | undefined> {
    try {
      return await Promise.any(
        hashes.map((hash) =>
          publicClient.waitForTransactionReceipt({ hash, timeout: receiptTimeout }),
        ),
      );
    } catch {
      return undefined;
    }
  }

  const resolve = (source: CallSource, attempt: Attempt) =>
    typeof source === 'function' ? source(attempt) : Promise.resolve(source);

  async function run(source: CallSource, hooks: SendHooks): Promise<TxOutcome> {
    let call: ContractCall;
    try {
      call = await resolve(source, 'first');
      await publicClient.simulateContract({ ...call, account } as never);
    } catch (error) {
      return refusal(error);
    }

    let signed: Awaited<ReturnType<typeof sign>>;
    let nonce: number;
    const replacing = hooks.replace;
    try {
      if (replacing) {
        nonce = replacing.nonce;
        signed = await sign(call, nonce, replacing.fees);
      } else {
        nextNonce ??= await publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        nonce = nextNonce;
        signed = await sign(call, nonce);
      }
    } catch (error) {
      // Nothing was signed into the world: the nonce was not used.
      if (!replacing) nextNonce = undefined;
      return refusal(error);
    }

    hooks.onSigned?.({ hash: signed.hash, nonce, replacement: Boolean(replacing) });
    try {
      await publicClient.sendRawTransaction({ serializedTransaction: signed.serialized });
    } catch (error) {
      if (!replacing) nextNonce = undefined;
      // Only a node that says plainly "I refuse this tx" proves it is not out there. A dropped
      // connection, a timeout or a vague "internal error" may hide a tx that did reach the mempool:
      // that is "unknown", and the hash is already persisted for recovery to resolve by nonce.
      return isDefiniteRefusal(error)
        ? { kind: 'not-sent', reason: describe(error) }
        : { kind: 'unknown', hash: signed.hash };
    }
    if (!replacing) nextNonce = nonce + 1;

    const first = await waitFor([signed.hash]);
    if (first) return mined(first);
    // A restart replacement is itself the one allowed replacement.
    if (replacing) {
      healthy = false;
      return { kind: 'unknown', hash: signed.hash, stuck: true };
    }
    if (!hooks.shouldReplace) return { kind: 'unknown', hash: signed.hash };

    let stillOpen: boolean;
    try {
      stillOpen = await hooks.shouldReplace();
    } catch {
      return { kind: 'unknown', hash: signed.hash };
    }
    if (!stillOpen) return { kind: 'unknown', hash: signed.hash };

    // One replacement, same nonce, fees +20%. The original may still be the one that mines, so both
    // hashes are watched.
    let replacement: Awaited<ReturnType<typeof sign>>;
    try {
      const again = await resolve(source, 'replacement');
      await publicClient.simulateContract({ ...again, account } as never);
      replacement = await sign(again, nonce, signed.prepared);
    } catch {
      // The simulation now reverts (usually QuestionNotOpen: the original mined) or the node is
      // down. Either way there is nothing to replace; the caller reads the chain.
      return { kind: 'unknown', hash: signed.hash };
    }
    hooks.onSigned?.({ hash: replacement.hash, nonce, replacement: true });
    try {
      await publicClient.sendRawTransaction({ serializedTransaction: replacement.serialized });
    } catch {
      const late = await waitFor([signed.hash]);
      return late ? mined(late) : { kind: 'unknown', hash: signed.hash };
    }
    const second = await waitFor([signed.hash, replacement.hash]);
    if (second) return mined(second);
    healthy = false;
    return { kind: 'unknown', hash: replacement.hash, stuck: true };
  }

  function mined(receipt: TransactionReceipt): TxOutcome {
    healthy = true;
    return {
      kind: 'mined',
      hash: receipt.transactionHash,
      success: receipt.status === 'success',
      logs: receipt.logs,
    };
  }

  return {
    send(call, hooks = {}) {
      const result = tail.then(() => run(call, hooks));
      // The chain must keep moving after a failure, and a rejected promise must not poison it.
      tail = result.catch(() => undefined);
      return result;
    },
    isHealthy: () => healthy,
  };
}

function bumpedFees(base: Fees): Record<string, bigint> {
  const bump = (value: bigint) =>
    (value * REPLACEMENT_FEE_NUMERATOR) / REPLACEMENT_FEE_DENOMINATOR + 1n;
  const fees: Record<string, bigint> = {};
  if (base.maxFeePerGas !== undefined) fees.maxFeePerGas = bump(base.maxFeePerGas);
  if (base.maxPriorityFeePerGas !== undefined) {
    fees.maxPriorityFeePerGas = bump(base.maxPriorityFeePerGas);
  }
  if (base.gasPrice !== undefined) fees.gasPrice = bump(base.gasPrice);
  return fees;
}

function refusal(error: unknown): TxOutcome {
  const name = revertName(error);
  return {
    kind: 'not-sent',
    reason: describe(error),
    ...(name ? { errorName: name } : {}),
    // Only a revert says "the contract refused it". Any other failure before the tx is signed (a
    // dead or flaky node, a gas estimate that failed) is the node's problem, and nothing was sent.
    ...(name || revertedByContract(error) ? {} : { rpcDown: true }),
  };
}

function revertedByContract(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof ContractFunctionRevertedError) !== null
  );
}

// The custom error of a reverted simulation, e.g. 'QuestionNotOpen'.
function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

// The node's own, specific reasons for refusing a transaction before it enters the mempool.
const REFUSALS = [
  NonceTooLowError,
  NonceTooHighError,
  InsufficientFundsError,
  IntrinsicGasTooLowError,
  IntrinsicGasTooHighError,
  FeeCapTooLowError,
  TipAboveFeeCapError,
  TransactionTypeNotSupportedError,
  ExecutionRevertedError,
] as const;

function isDefiniteRefusal(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk((cause) => REFUSALS.some((refusal) => cause instanceof refusal)) !== null
  );
}

function describe(error: unknown): string {
  return error instanceof BaseError ? error.shortMessage : 'unexpected error';
}
