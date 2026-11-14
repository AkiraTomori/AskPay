// Sends provider-wallet transactions one at a time (T-10), so two requests never race for a nonce.
//
// A4 scope: simulate first, send, wait for the receipt. What a caller must know is whether money
// may have moved, so the result says it plainly:
//   mined     a receipt exists (success or revert)
//   not-sent  nothing reached the network (simulation reverted, or the node refused the tx)
//   unknown   the tx may be on the network but there is no receipt yet; never treat it as failed
// Persisting pending_tx/nonce before sending, the single replacement tx and restart recovery are
// A5 (system-design §5.6 C and D).
import { BaseError, HttpRequestError, TimeoutError, type Abi, type Hex } from 'viem';
import type { ChainClients } from './chain.js';

export const RECEIPT_TIMEOUT_MS = 30_000;

export type TxOutcome =
  | { kind: 'mined'; hash: Hex; success: boolean }
  | { kind: 'not-sent'; reason: string }
  | { kind: 'unknown'; hash?: Hex };

export interface ContractCall {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args: readonly unknown[];
}

export interface TxQueue {
  send(call: ContractCall): Promise<TxOutcome>;
}

export function createTxQueue(
  clients: ChainClients,
  options: { receiptTimeoutMs?: number } = {},
): TxQueue {
  const { publicClient, walletClient, account } = clients;
  const receiptTimeout = options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS;
  // In memory, started from the pending count; resynced after any refused send.
  let nextNonce: number | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  async function run(call: ContractCall): Promise<TxOutcome> {
    try {
      await publicClient.simulateContract({ ...call, account });
    } catch (error) {
      return { kind: 'not-sent', reason: describe(error) };
    }

    let hash: Hex;
    try {
      nextNonce ??= await publicClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      });
      hash = await walletClient.writeContract({ ...call, nonce: nextNonce });
      nextNonce += 1;
    } catch (error) {
      // A transport failure may hide a tx that did reach the network: that is "unknown".
      // Anything else is the node refusing the tx, so it never entered the mempool.
      nextNonce = undefined;
      return isTransportError(error)
        ? { kind: 'unknown' }
        : { kind: 'not-sent', reason: describe(error) };
    }

    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: receiptTimeout,
      });
      return { kind: 'mined', hash, success: receipt.status === 'success' };
    } catch {
      return { kind: 'unknown', hash };
    }
  }

  return {
    send(call) {
      const result = tail.then(() => run(call));
      // The chain must keep moving after a failure, and a rejected promise must not poison it.
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof BaseError)) return true;
  return Boolean(
    error.walk((cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError),
  );
}

function describe(error: unknown): string {
  return error instanceof BaseError ? error.shortMessage : 'unexpected error';
}
