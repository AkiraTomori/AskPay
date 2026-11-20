import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { classifyClaimError, refundedByClaim } from '@/features/ask/claim';
import { ACCOUNT_A } from '../../helpers/wallet-harness';
import { QID } from '../../helpers/ask-api';

const OTHER = `0x${'ab'.repeat(20)}` as const;

// A Refunded log as the escrow emits it: topics [sig, qid, payer], data [amount, reason].
function refundedLog(over: { address?: string; qid?: Hex; reason?: number } = {}) {
  const topics = encodeEventTopics({
    abi: askPayEscrowAbi,
    eventName: 'Refunded',
    args: { qid: over.qid ?? QID, payer: ACCOUNT_A },
  });
  return {
    address: (over.address ?? fujiDeployment.address) as `0x${string}`,
    topics: topics as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }],
      [50_000n, over.reason ?? 5],
    ),
    blockNumber: 1n,
    blockHash: `0x${'01'.repeat(32)}` as Hex,
    transactionHash: `0x${'02'.repeat(32)}` as Hex,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

describe('W5-E09 a Refunded log counts only from this escrow, for this qid, as a Timeout', () => {
  it('accepts the genuine log', () => {
    expect(refundedByClaim({ status: 'success', logs: [refundedLog()] }, QID)).toEqual({
      qid: QID,
      payer: ACCOUNT_A,
      amount: 50_000n,
    });
  });

  it('ignores a log from another contract, another qid, another reason, or a reverted tx', () => {
    const other = `0x${'cd'.repeat(32)}` as Hex;
    for (const log of [
      refundedLog({ address: OTHER }),
      refundedLog({ qid: other }),
      refundedLog({ reason: 4 }), // ANSWER_FAILED: the server's refund, not a claim
    ]) {
      expect(refundedByClaim({ status: 'success', logs: [log] }, QID)).toBeUndefined();
    }
    expect(refundedByClaim({ status: 'reverted', logs: [refundedLog()] }, QID)).toBeUndefined();
    expect(refundedByClaim({ status: 'success', logs: [] }, QID)).toBeUndefined();
  });

  it('finds the genuine log among others', () => {
    const logs = [refundedLog({ address: OTHER }), refundedLog()];
    expect(refundedByClaim({ status: 'success', logs }, QID)?.amount).toBe(50_000n);
  });
});

// A viem error shaped like the one simulateContract throws for a custom error of the escrow.
function revert(errorName: 'QuestionNotOpen' | 'DeadlineNotReached' | 'BadCitations') {
  // The node returns the raw revert data; viem decodes it with the ABI (the custom errors carry args).
  const raw =
    errorName === 'QuestionNotOpen'
      ? encodeErrorResult({ abi: askPayEscrowAbi, errorName, args: [QID] })
      : errorName === 'DeadlineNotReached'
        ? encodeErrorResult({ abi: askPayEscrowAbi, errorName, args: [QID, 1_700_000_600n] })
        : encodeErrorResult({ abi: askPayEscrowAbi, errorName });
  const reverted = new ContractFunctionRevertedError({
    abi: askPayEscrowAbi,
    data: raw,
    functionName: 'claimRefund',
  });
  return new ContractFunctionExecutionError(reverted, {
    abi: askPayEscrowAbi,
    functionName: 'claimRefund',
    args: [QID],
  });
}

describe('classifyClaimError decodes the contract error with the shared ABI', () => {
  it('QuestionNotOpen -> notOpen, DeadlineNotReached -> notYet', () => {
    expect(classifyClaimError(revert('QuestionNotOpen'))).toEqual({ kind: 'notOpen' });
    expect(classifyClaimError(revert('DeadlineNotReached'))).toEqual({
      kind: 'notYet',
      deadline: 1_700_000_600n,
    });
  });

  it('another contract error -> other; no contract error at all -> rpc', () => {
    expect(classifyClaimError(revert('BadCitations'))).toEqual({ kind: 'other' });
    const transport = new ContractFunctionExecutionError(
      new HttpRequestError({ url: 'https://rpc', body: {} }),
      { abi: askPayEscrowAbi, functionName: 'claimRefund', args: [QID] },
    );
    expect(classifyClaimError(transport)).toEqual({ kind: 'rpc' });
    expect(classifyClaimError(new Error('boom'))).toEqual({ kind: 'rpc' });
    expect(classifyClaimError(undefined)).toEqual({ kind: 'other' });
  });
});
