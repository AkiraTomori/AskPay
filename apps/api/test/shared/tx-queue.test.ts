import { describe, expect, it, vi } from 'vitest';
import { BaseError, HttpRequestError } from 'viem';
import type { ChainClients } from '../../src/shared/chain.js';
import { createTxQueue, type ContractCall } from '../../src/shared/tx-queue.js';

const call: ContractCall = {
  abi: [],
  address: `0x${'01'.repeat(20)}`,
  functionName: 'deposit',
  args: [],
};
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

function fakeClients(overrides: Record<string, unknown> = {}) {
  let sent = 0;
  const publicClient = {
    simulateContract: vi.fn(async () => ({})),
    getTransactionCount: vi.fn(async () => 7),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
    ...overrides,
  };
  const walletClient = {
    writeContract: vi.fn(async (request: { nonce?: number }) => {
      void request;
      return hash(++sent);
    }),
  };
  const clients = {
    account: { address: `0x${'02'.repeat(20)}` },
    publicClient,
    walletClient,
  } as unknown as ChainClients;
  return { clients, publicClient, walletClient };
}

describe('tx-queue outcomes', () => {
  it('mined + success when the receipt says success', async () => {
    const { clients } = fakeClients();
    expect(await createTxQueue(clients).send(call)).toEqual({
      kind: 'mined',
      hash: hash(1),
      success: true,
    });
  });

  it('mined + not success when the receipt reverted', async () => {
    const { clients } = fakeClients({
      waitForTransactionReceipt: vi.fn(async () => ({ status: 'reverted' })),
    });
    expect(await createTxQueue(clients).send(call)).toEqual({
      kind: 'mined',
      hash: hash(1),
      success: false,
    });
  });

  it('not-sent, and nothing signed, when the simulation reverts', async () => {
    const { clients, walletClient } = fakeClients({
      simulateContract: vi.fn(async () => {
        throw new BaseError('execution reverted');
      }),
    });
    const outcome = await createTxQueue(clients).send(call);
    expect(outcome.kind).toBe('not-sent');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('unknown, not failed, when the RPC breaks while sending (the tx may be out)', async () => {
    const { clients, walletClient } = fakeClients();
    walletClient.writeContract.mockRejectedValueOnce(new HttpRequestError({ url: 'http://rpc' }));
    expect(await createTxQueue(clients).send(call)).toEqual({ kind: 'unknown' });
  });

  it('not-sent when the node refuses the tx, and the nonce is read again afterwards', async () => {
    const { clients, publicClient, walletClient } = fakeClients();
    walletClient.writeContract.mockRejectedValueOnce(new BaseError('nonce too low'));
    const queue = createTxQueue(clients);
    expect((await queue.send(call)).kind).toBe('not-sent');
    await queue.send(call);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  it('unknown, with the hash, when no receipt arrives in time', async () => {
    const { clients } = fakeClients({
      waitForTransactionReceipt: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    expect(await createTxQueue(clients).send(call)).toEqual({ kind: 'unknown', hash: hash(1) });
  });
});

describe('tx-queue ordering (T-10)', () => {
  it('runs transactions one at a time with consecutive nonces', async () => {
    const { clients, publicClient, walletClient } = fakeClients();
    let active = 0;
    let overlapped = false;
    publicClient.waitForTransactionReceipt.mockImplementation(async () => {
      active += 1;
      overlapped ||= active > 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 'success' };
    });
    const queue = createTxQueue(clients);
    await Promise.all([queue.send(call), queue.send(call), queue.send(call)]);

    expect(overlapped).toBe(false);
    expect(walletClient.writeContract.mock.calls.map(([request]) => request.nonce)).toEqual([
      7, 8, 9,
    ]);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it('keeps working after one transaction failed', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.simulateContract.mockRejectedValueOnce(new BaseError('revert'));
    const queue = createTxQueue(clients);
    const [first, second] = await Promise.all([queue.send(call), queue.send(call)]);
    expect(first.kind).toBe('not-sent');
    expect(second.kind).toBe('mined');
  });
});
