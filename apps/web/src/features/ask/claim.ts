import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import { REFUND_REASON_BY_INDEX } from '@askpay/shared/errors';
import {
  BaseError,
  ContractFunctionRevertedError,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';

// Pure helpers for claimRefund (design W5 §3.3, §4). No React, no network: tests feed them data
// encoded by viem itself.

export type ClaimFailure =
  | { kind: 'notOpen' }
  // The contract names the deadline it checked, so the page can wait for exactly that block.
  | { kind: 'notYet'; deadline: bigint | undefined }
  | { kind: 'rpc' }
  | { kind: 'other' };

// Why a simulation failed. The contract's own custom errors are named; a revert with anything else
// is `other`; no revert at all means the node could not be asked, which is `rpc`. The UI never guesses.
export function classifyClaimError(error: unknown): ClaimFailure {
  if (!(error instanceof BaseError)) return { kind: error instanceof Error ? 'rpc' : 'other' };
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    switch (reverted.data?.errorName) {
      case 'QuestionNotOpen':
        return { kind: 'notOpen' };
      case 'DeadlineNotReached': {
        const args = reverted.data.args as readonly unknown[] | undefined;
        const deadline = args?.[1];
        return { kind: 'notYet', deadline: typeof deadline === 'bigint' ? deadline : undefined };
      }
      default:
        return { kind: 'other' };
    }
  }
  // No contract error in the chain: the node could not be asked (network, timeout, 5xx).
  return { kind: 'rpc' };
}

// The wallet has no AVAX for gas: viem names it, and some wallets only say it in the message.
export function isInsufficientGas(error: unknown): boolean {
  if (!(error instanceof BaseError)) {
    return error instanceof Error && /insufficient funds/i.test(error.message);
  }
  return (
    error.walk(
      (e) =>
        (e as { name?: string }).name === 'InsufficientFundsError' ||
        /insufficient funds/i.test((e as { message?: string }).message ?? ''),
    ) !== null
  );
}

export type RefundedByClaim = { qid: Hex; payer: Address; amount: bigint };

// The `Refunded` log that proves THIS claim worked: the receipt succeeded, the log was emitted by
// the AskPay escrow (not any contract that happens to share the event), it is for this qid, and the
// reason is Timeout. Anything else is not accepted as proof (U-21, P2).
export function refundedByClaim(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  qid: Hex,
  escrow: Address = fujiDeployment.address,
): RefundedByClaim | undefined {
  if (receipt.status !== 'success') return undefined;
  const logs = parseEventLogs({
    abi: askPayEscrowAbi,
    eventName: 'Refunded',
    logs: receipt.logs,
    strict: false,
  });
  for (const log of logs) {
    const { args } = log;
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    if (args.qid === undefined || args.qid.toLowerCase() !== qid.toLowerCase()) continue;
    if (REFUND_REASON_BY_INDEX[Number(args.reason)] !== 'TIMEOUT') continue;
    if (args.payer === undefined || args.amount === undefined) continue;
    return { qid, payer: args.payer, amount: args.amount };
  }
  return undefined;
}
