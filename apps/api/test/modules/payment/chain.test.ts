// payment.chain against fake viem clients: the receipt decoding that decides PAID and REFUNDED (P2),
// the contract call shapes, and the startup checks that stop a server with the wrong keys or the
// wrong corpus from ever taking money.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex, type Log } from 'viem';
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import { BLLD_2019_LAW_ID } from '@askpay/shared/leaf';
import {
  REFUND_REASON_BY_INDEX,
  createPaymentChain,
  type PaymentChain,
} from '../../../src/modules/payment/payment.chain.js';
import type { ChainClients } from '../../../src/shared/chain.js';
import type { ContractCall, TxOutcome, TxQueue } from '../../../src/shared/tx-queue.js';

const ESCROW = fujiDeployment.address;
const PROVIDER = `0x${'0a'.repeat(20)}` as const;
const CHECKER = `0x${'0c'.repeat(20)}` as const;
const ROOT: Hex = `0x${'ee'.repeat(32)}`;
const QID: Hex = `0x${'9f'.repeat(32)}`;
const OTHER_QID: Hex = `0x${'8e'.repeat(32)}`;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

function fakeClients(overrides: { checker?: string; root?: string; provider?: string } = {}) {
  const reads: Record<string, unknown> = {
    token: '0x5425890298aed601595a70AB815c96711a31Bc65',
    provider: overrides.provider ?? PROVIDER,
    checker: overrides.checker ?? CHECKER,
    answerWindow: 600n,
    lawRoot: overrides.root ?? ROOT,
    name: 'USD Coin',
    version: '2',
  };
  const publicClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => reads[functionName]),
  };
  return {
    account: { address: PROVIDER },
    publicClient,
    walletClient: {},
  } as unknown as ChainClients;
}

function fakeQueue(outcome: TxOutcome = { kind: 'unknown' }) {
  const calls: ContractCall[] = [];
  const queue: TxQueue = {
    send: vi.fn(async (source) => {
      calls.push(typeof source === 'function' ? await source('first') : source);
      return outcome;
    }),
    isHealthy: () => true,
  };
  return { queue, calls };
}

const expectations = { checker: CHECKER, lawId: BLLD_2019_LAW_ID, lawRoot: ROOT } as const;
const make = (queue: TxQueue, clients = fakeClients()) =>
  createPaymentChain(clients, queue, expectations);

function paidLog(address: string, qid: Hex): Log {
  return {
    address,
    topics: encodeEventTopics({
      abi: askPayEscrowAbi,
      eventName: 'Paid',
      args: { qid, provider: PROVIDER },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [50_000n, hash(0xa1), hash(0xc1)],
    ),
  } as unknown as Log;
}

function refundedLog(address: string, qid: Hex, reason: number): Log {
  return {
    address,
    topics: encodeEventTopics({
      abi: askPayEscrowAbi,
      eventName: 'Refunded',
      args: { qid, payer: PROVIDER },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint8' }], [50_000n, reason]),
  } as unknown as Log;
}

const minedWith = (...logs: Log[]): TxOutcome => ({
  kind: 'mined',
  hash: hash(1),
  success: true,
  logs,
});
const request = {
  qid: QID,
  answerHash: hash(0xa1),
  citations: [],
  proofs: [],
  pass: true,
  checkerSig: '0x' as Hex,
};

describe('P2 PAID and REFUNDED come only from a Paid or Refunded log of THIS escrow for THIS qid', () => {
  it('decodes Paid with the hashes the contract emitted', async () => {
    const { queue } = fakeQueue(minedWith(paidLog(ESCROW, QID)));
    const chain = await make(queue);
    expect(await chain.refund(QID)).toMatchObject({
      event: { name: 'Paid', answerHash: hash(0xa1), citationsHash: hash(0xc1) },
    });
  });

  it('ignores a Paid log emitted by another contract', async () => {
    const { queue } = fakeQueue(minedWith(paidLog(`0x${'bb'.repeat(20)}`, QID)));
    const result = await (await make(queue)).refund(QID);
    expect(result).not.toHaveProperty('event');
  });

  it('ignores a Paid log for another question', async () => {
    const { queue } = fakeQueue(minedWith(paidLog(ESCROW, OTHER_QID)));
    const result = await (await make(queue)).refund(QID);
    expect(result).not.toHaveProperty('event');
  });

  it('gives no event for a reverted tx, even if logs were somehow present', async () => {
    const { queue } = fakeQueue({
      kind: 'mined',
      hash: hash(1),
      success: false,
      logs: [paidLog(ESCROW, QID)],
    });
    expect(await (await make(queue)).refund(QID)).not.toHaveProperty('event');
  });

  it.each([
    [1, 'NO_CITATION'],
    [2, 'INVALID_CITATION'],
    [3, 'CHECKER_REJECTED'],
    [4, 'ANSWER_FAILED'],
    [5, 'TIMEOUT'],
  ])('maps Refunded reason %i to %s', async (index, code) => {
    const { queue } = fakeQueue(minedWith(refundedLog(ESCROW, QID, index)));
    expect(await (await make(queue)).refund(QID)).toMatchObject({
      event: { name: 'Refunded', reason: code },
    });
  });

  it('keeps the reason order equal to the Solidity enum', () => {
    const source = readFileSync('contracts/src/AskPayEscrow.sol', 'utf8');
    const body = /enum RefundReason \{([^}]*)\}/.exec(source)?.[1] ?? '';
    const names = body.split(',').map((name) => name.trim());
    const snake = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    expect(REFUND_REASON_BY_INDEX).toEqual(names.map(snake));
  });
});

describe('contract calls', () => {
  it('settle sends the citation tuples and proofs when there is time', async () => {
    const { queue, calls } = fakeQueue();
    const chain: PaymentChain = await make(queue);
    const citation = { lawId: hash(1), dieu: 25, khoan: 2, textHash: hash(2), quoteHash: hash(3) };
    await chain.settle(
      { ...request, citations: [citation], proofs: [[hash(9)]] },
      async () => 'settle',
    );
    expect(calls[0]).toMatchObject({ functionName: 'settle' });
    expect(calls[0]?.args).toEqual([QID, hash(0xa1), [citation], [[hash(9)]], true, '0x']);
  });

  it('settle becomes refundByProvider when the caller decides so (the cutoff)', async () => {
    const { queue, calls } = fakeQueue();
    await (await make(queue)).settle(request, async () => 'refund');
    expect(calls[0]).toMatchObject({ functionName: 'refundByProvider', args: [QID] });
  });
});

describe('startup checks: no money is taken with the wrong keys or the wrong corpus', () => {
  const { queue } = fakeQueue();

  it('accepts the matching deployment', async () => {
    await expect(make(queue)).resolves.toBeTruthy();
  });

  it("refuses a checker key that is not the escrow's on-chain checker", async () => {
    await expect(make(queue, fakeClients({ checker: `0x${'dd'.repeat(20)}` }))).rejects.toThrow(
      /CHECKER_PRIVATE_KEY/,
    );
  });

  it('compares with the chain, in any letter case', async () => {
    const mixed = `0x${'0C'.repeat(20)}`;
    await expect(make(queue, fakeClients({ checker: mixed }))).resolves.toBeTruthy();
  });

  it('refuses a provider key that is not the escrow provider', async () => {
    await expect(make(queue, fakeClients({ provider: `0x${'dd'.repeat(20)}` }))).rejects.toThrow(
      /PROVIDER_PRIVATE_KEY/,
    );
  });

  it('refuses a corpus whose root is not the one registered on-chain', async () => {
    await expect(make(queue, fakeClients({ root: `0x${'ff'.repeat(32)}` }))).rejects.toThrow(
      /corpus root/,
    );
  });

  it('refuses when no root is registered for the law at all', async () => {
    await expect(make(queue, fakeClients({ root: `0x${'00'.repeat(32)}` }))).rejects.toThrow(
      /corpus root/,
    );
  });
});
