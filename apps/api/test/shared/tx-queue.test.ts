import { describe, expect, it, vi } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  NonceTooLowError,
  encodeErrorResult,
  keccak256,
  parseAbi,
  type Hex,
} from 'viem';
import type { ChainClients } from '../../src/shared/chain.js';
import { createTxQueue, type ContractCall } from '../../src/shared/tx-queue.js';

const abi = parseAbi([
  'function deposit()',
  'function settle()',
  'function refundByProvider()',
  'error QuestionNotOpen(bytes32 qid)',
]);
const call = (
  functionName: 'deposit' | 'settle' | 'refundByProvider' = 'deposit',
): ContractCall => ({
  abi,
  address: `0x${'01'.repeat(20)}`,
  functionName,
  args: [],
});

// The queue signs locally, so the fakes stand in for viem's prepare/sign/send/wait. A signed tx is
// just a unique string; its hash is the real keccak256 of it, like the queue computes.
function fakeClients() {
  let counter = 0;
  const events: string[] = [];
  const serializedOf = new Map<Hex, string>();
  const publicClient = {
    simulateContract: vi.fn(async (request: unknown) => {
      void request;
      return {};
    }),
    getTransactionCount: vi.fn(async () => 7),
    sendRawTransaction: vi.fn(async (request: { serializedTransaction: Hex }) => {
      events.push('send');
      return keccak256(request.serializedTransaction);
    }),
    // Default: every tx is mined at once.
    waitForTransactionReceipt: vi.fn(async (request: { hash: Hex }) => ({
      status: 'success' as 'success' | 'reverted',
      transactionHash: request.hash,
    })),
  };
  const walletClient = {
    prepareTransactionRequest: vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      maxFeePerGas: (request.maxFeePerGas as bigint | undefined) ?? 100n,
      maxPriorityFeePerGas: (request.maxPriorityFeePerGas as bigint | undefined) ?? 10n,
    })),
    signTransaction: vi.fn(async (prepared: { nonce: number; data: Hex }) => {
      counter += 1;
      const serialized: Hex = `0x${counter.toString(16).padStart(8, '0')}${prepared.nonce
        .toString(16)
        .padStart(4, '0')}`;
      serializedOf.set(keccak256(serialized), prepared.data);
      return serialized;
    }),
  };
  const clients = {
    account: { address: `0x${'02'.repeat(20)}` },
    publicClient,
    walletClient,
  } as unknown as ChainClients;
  return {
    clients,
    publicClient,
    walletClient,
    events,
    dataOf: (hash: Hex) => serializedOf.get(hash),
  };
}

const noReceipt = () =>
  vi.fn(async () => {
    throw new Error('timeout');
  });

describe('tx-queue outcomes', () => {
  it('mined + success, with the hash of the tx it signed', async () => {
    const { clients, walletClient } = fakeClients();
    const outcome = await createTxQueue(clients).send(call());
    const signed = (await walletClient.signTransaction.mock.results[0]?.value) as Hex;
    expect(outcome).toEqual({ kind: 'mined', hash: keccak256(signed), success: true });
  });

  it('mined + not success when the receipt reverted', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.waitForTransactionReceipt.mockImplementation(async (request) => ({
      status: 'reverted' as const,
      transactionHash: request.hash,
    }));
    expect(await createTxQueue(clients).send(call())).toMatchObject({
      kind: 'mined',
      success: false,
    });
  });

  it('not-sent, and nothing signed, when the simulation reverts', async () => {
    const { clients, publicClient, walletClient } = fakeClients();
    publicClient.simulateContract.mockRejectedValueOnce(new BaseError('execution reverted'));
    const outcome = await createTxQueue(clients).send(call());
    expect(outcome.kind).toBe('not-sent');
    expect(walletClient.signTransaction).not.toHaveBeenCalled();
    expect(publicClient.getTransactionCount).not.toHaveBeenCalled();
  });

  it('tells a node failure from a contract revert: only the first is rpcDown', async () => {
    const { clients, publicClient } = fakeClients();
    // A JSON-RPC error that is not a revert (a flaky node, a failed gas estimate).
    publicClient.simulateContract.mockRejectedValueOnce(new BaseError('internal error'));
    expect(await createTxQueue(clients).send(call())).toMatchObject({
      kind: 'not-sent',
      rpcDown: true,
    });

    const data = encodeErrorResult({
      abi,
      errorName: 'QuestionNotOpen',
      args: [`0x${'aa'.repeat(32)}`],
    });
    const reverted = new ContractFunctionRevertedError({ abi, data, functionName: 'deposit' });
    publicClient.simulateContract.mockRejectedValueOnce(
      new BaseError('reverted', { cause: reverted }),
    );
    const outcome = await createTxQueue(clients).send(call());
    expect(outcome).toMatchObject({ kind: 'not-sent', errorName: 'QuestionNotOpen' });
    expect(outcome).not.toHaveProperty('rpcDown');
  });

  it('names the contract error of a reverted simulation, so callers never parse a message', async () => {
    const { clients, publicClient } = fakeClients();
    const data = encodeErrorResult({
      abi,
      errorName: 'QuestionNotOpen',
      args: [`0x${'aa'.repeat(32)}`],
    });
    const reverted = new ContractFunctionRevertedError({ abi, data, functionName: 'settle' });
    publicClient.simulateContract.mockRejectedValueOnce(
      new BaseError('reverted', { cause: reverted }),
    );
    expect(await createTxQueue(clients).send(call('settle'))).toMatchObject({
      kind: 'not-sent',
      errorName: 'QuestionNotOpen',
    });
  });

  it('unknown, with the hash, when the RPC breaks while sending (the tx may be out)', async () => {
    const { clients, publicClient, walletClient } = fakeClients();
    publicClient.sendRawTransaction.mockRejectedValueOnce(
      new HttpRequestError({ url: 'http://rpc' }),
    );
    const outcome = await createTxQueue(clients).send(call());
    const signed = (await walletClient.signTransaction.mock.results[0]?.value) as Hex;
    expect(outcome).toEqual({ kind: 'unknown', hash: keccak256(signed) });
  });

  it('not-sent when the node refuses the tx plainly, and the nonce is read again afterwards', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.sendRawTransaction.mockRejectedValueOnce(
      new BaseError('send failed', { cause: new NonceTooLowError({ nonce: 3 }) }),
    );
    const queue = createTxQueue(clients);
    expect((await queue.send(call())).kind).toBe('not-sent');
    await queue.send(call());
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  it('unknown, with the hash, when the node answers a vague internal error: the tx may be out', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.sendRawTransaction.mockRejectedValueOnce(
      new BaseError('An internal error was received.'),
    );
    const outcome = await createTxQueue(clients).send(call());
    expect(outcome).toMatchObject({ kind: 'unknown' });
    expect(outcome).toHaveProperty('hash');
  });

  it('not-sent, with no nonce consumed, when the chain cannot be read before signing', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.getTransactionCount.mockRejectedValueOnce(
      new HttpRequestError({ url: 'http://rpc' }),
    );
    const queue = createTxQueue(clients);
    expect((await queue.send(call())).kind).toBe('not-sent');
    expect((await queue.send(call())).kind).toBe('mined');
  });

  it('unknown, with the hash, when no receipt arrives and no replacement is wanted', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.waitForTransactionReceipt = noReceipt();
    const outcome = await createTxQueue(clients).send(call());
    expect(outcome).toMatchObject({ kind: 'unknown' });
    expect(publicClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('tx-queue persists before sending (§5.6 C)', () => {
  it('calls onSigned with the hash and nonce before the tx reaches the network', async () => {
    const { clients, events } = fakeClients();
    const onSigned = vi.fn(() => {
      events.push('persist');
    });
    const outcome = await createTxQueue(clients).send(call(), { onSigned });

    expect(events).toEqual(['persist', 'send']);
    expect(onSigned).toHaveBeenCalledWith({
      hash: outcome.kind === 'mined' ? outcome.hash : 'unreachable',
      nonce: 7,
      replacement: false,
    });
  });

  it('has already persisted the hash when the send fails mid-air', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.sendRawTransaction.mockRejectedValueOnce(
      new HttpRequestError({ url: 'http://rpc' }),
    );
    const onSigned = vi.fn();
    const outcome = await createTxQueue(clients).send(call(), { onSigned });
    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ kind: 'unknown', hash: onSigned.mock.calls[0]?.[0].hash });
  });

  it('does not persist anything when the simulation reverts', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.simulateContract.mockRejectedValueOnce(new BaseError('revert'));
    const onSigned = vi.fn();
    await createTxQueue(clients).send(call(), { onSigned });
    expect(onSigned).not.toHaveBeenCalled();
  });
});

describe('tx-queue replacement (§5.6 C)', () => {
  // First tx: no receipt. Everything after: depends on the test.
  // Only the replacement ever mines; the original stays out.
  function stuckFirst(clients: ReturnType<typeof fakeClients>) {
    const { publicClient } = clients;
    let original: Hex | undefined;
    publicClient.waitForTransactionReceipt.mockImplementation(async (request) => {
      original ??= request.hash;
      if (request.hash === original) throw new Error('timeout');
      return { status: 'success' as const, transactionHash: request.hash };
    });
  }

  it('sends one replacement with the same nonce and fees raised by 20%, and reports it mined', async () => {
    const fake = fakeClients();
    stuckFirst(fake);
    const onSigned = vi.fn();
    const outcome = await createTxQueue(fake.clients).send(call('settle'), {
      onSigned,
      shouldReplace: async () => true,
    });

    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(onSigned.mock.calls.map(([tx]) => [tx.nonce, tx.replacement])).toEqual([
      [7, false],
      [7, true],
    ]);
    const [, replacementRequest] = fake.walletClient.prepareTransactionRequest.mock.calls;
    expect(replacementRequest?.[0]).toMatchObject({
      nonce: 7,
      maxFeePerGas: 121n, // 100 * 12 / 10 + 1
      maxPriorityFeePerGas: 13n, // 10 * 12 / 10 + 1
    });
    expect(outcome).toMatchObject({ kind: 'mined', success: true });
    expect(onSigned.mock.calls[1]?.[0].hash).toBe(outcome.kind === 'mined' ? outcome.hash : '');
  });

  it('does not replace when the question is no longer open', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    const outcome = await createTxQueue(fake.clients).send(call(), {
      shouldReplace: async () => false,
    });
    expect(outcome.kind).toBe('unknown');
    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not replace when it cannot tell whether the question is open', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    const outcome = await createTxQueue(fake.clients).send(call(), {
      shouldReplace: async () => {
        throw new Error('rpc down');
      },
    });
    expect(outcome.kind).toBe('unknown');
    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('asks the caller again for the replacement, so a settle can turn into a refund', async () => {
    const fake = fakeClients();
    stuckFirst(fake);
    const source = vi.fn(async (attempt: 'first' | 'replacement') =>
      call(attempt === 'first' ? 'settle' : 'refundByProvider'),
    );
    const onSigned = vi.fn();
    await createTxQueue(fake.clients).send(source, { onSigned, shouldReplace: async () => true });

    expect(source.mock.calls.map(([attempt]) => attempt)).toEqual(['first', 'replacement']);
    const [first, second] = fake.publicClient.simulateContract.mock.calls as unknown as [
      [{ functionName: string }],
      [{ functionName: string }],
    ];
    expect([first[0].functionName, second[0].functionName]).toEqual(['settle', 'refundByProvider']);
    expect(fake.dataOf(onSigned.mock.calls[0]?.[0].hash)).not.toBe(
      fake.dataOf(onSigned.mock.calls[1]?.[0].hash),
    );
  });

  it('sends no replacement when the replacement simulation now reverts (the original mined)', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    fake.publicClient.simulateContract
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new BaseError('QuestionNotOpen'));
    const outcome = await createTxQueue(fake.clients).send(call(), {
      shouldReplace: async () => true,
    });
    expect(outcome.kind).toBe('unknown');
    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports the ORIGINAL when it is the one that mines during the replacement window', async () => {
    const fake = fakeClients();
    let originalHash: Hex | undefined;
    fake.publicClient.waitForTransactionReceipt.mockImplementation(async (request) => {
      originalHash ??= request.hash;
      // The first wait (original only) times out; later the original appears, the replacement never.
      if (
        fake.publicClient.sendRawTransaction.mock.calls.length < 2 ||
        request.hash !== originalHash
      ) {
        throw new Error('timeout');
      }
      return { status: 'success' as const, transactionHash: request.hash };
    });
    const outcome = await createTxQueue(fake.clients).send(call(), {
      shouldReplace: async () => true,
    });
    expect(outcome).toEqual({ kind: 'mined', hash: originalHash, success: true });
  });

  it('turns unhealthy when the replacement is stuck too, and healthy again once something mines', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    const queue = createTxQueue(fake.clients);
    const outcome = await queue.send(call(), { shouldReplace: async () => true });

    expect(outcome).toMatchObject({ kind: 'unknown', stuck: true });
    expect(queue.isHealthy()).toBe(false);

    fake.publicClient.waitForTransactionReceipt.mockImplementation(
      async (request: { hash: Hex }) => ({
        status: 'success' as const,
        transactionHash: request.hash,
      }),
    );
    await queue.send(call());
    expect(queue.isHealthy()).toBe(true);
  });

  it('replaces at most once', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    await createTxQueue(fake.clients).send(call(), { shouldReplace: async () => true });
    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('tx-queue replace after a restart (§5.6 D)', () => {
  it('re-sends at the stored nonce with the old fees +20%, without touching the nonce counter', async () => {
    const fake = fakeClients();
    const onSigned = vi.fn();
    const queue = createTxQueue(fake.clients);
    const outcome = await queue.send(call('refundByProvider'), {
      onSigned,
      replace: { nonce: 3, fees: { maxFeePerGas: 200n, maxPriorityFeePerGas: 20n } },
    });

    expect(outcome.kind).toBe('mined');
    expect(fake.publicClient.getTransactionCount).not.toHaveBeenCalled();
    expect(fake.walletClient.prepareTransactionRequest.mock.calls[0]?.[0]).toMatchObject({
      nonce: 3,
      maxFeePerGas: 241n, // 200 * 12 / 10 + 1
      maxPriorityFeePerGas: 25n,
    });
    expect(onSigned).toHaveBeenCalledWith(expect.objectContaining({ nonce: 3, replacement: true }));
    // The next ordinary tx still starts from the chain's pending count, not from nonce 3.
    await queue.send(call());
    expect(fake.walletClient.prepareTransactionRequest.mock.calls[1]?.[0]).toMatchObject({
      nonce: 7,
    });
  });

  it('is itself the one replacement: stuck again means unhealthy, not another try', async () => {
    const fake = fakeClients();
    fake.publicClient.waitForTransactionReceipt = noReceipt();
    const queue = createTxQueue(fake.clients);
    const outcome = await queue.send(call(), { replace: { nonce: 3, fees: {} } });
    expect(outcome).toMatchObject({ kind: 'unknown', stuck: true });
    expect(queue.isHealthy()).toBe(false);
    expect(fake.publicClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('tx-queue ordering (T-10)', () => {
  it('runs transactions one at a time with consecutive nonces', async () => {
    const { clients, publicClient, walletClient } = fakeClients();
    let active = 0;
    let overlapped = false;
    publicClient.waitForTransactionReceipt.mockImplementation(async (request) => {
      active += 1;
      overlapped ||= active > 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 'success' as const, transactionHash: request.hash };
    });
    const queue = createTxQueue(clients);
    await Promise.all([queue.send(call()), queue.send(call()), queue.send(call())]);

    expect(overlapped).toBe(false);
    expect(
      walletClient.prepareTransactionRequest.mock.calls.map(([request]) => request.nonce),
    ).toEqual([7, 8, 9]);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it('keeps working after one transaction failed', async () => {
    const { clients, publicClient } = fakeClients();
    publicClient.simulateContract.mockRejectedValueOnce(new BaseError('revert'));
    const queue = createTxQueue(clients);
    const [first, second] = await Promise.all([queue.send(call()), queue.send(call())]);
    expect(first.kind).toBe('not-sent');
    expect(second.kind).toBe('mined');
  });
});
