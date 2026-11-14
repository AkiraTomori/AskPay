// Deposit-side safety that A4 left to A5 (system-design §5.6 A, C): what is stored before a deposit
// is sent, and what the payer is told when the node or the queue is not working.
import { describe, expect, it } from 'vitest';
import {
  PRICE,
  createFakeChain,
  createTestApp,
  requestQuote,
  requirementOf,
  signPayment,
  pay,
  rowOf,
  stageOf,
} from '../../harness.js';

async function prepared(test = createTestApp()) {
  const quote = await requestQuote(test);
  return { test, quote, qid: requirementOf(quote).extra.qid as `0x${string}` };
}

describe('§5.6 C the deposit hash and nonce are stored before the tx is sent', () => {
  it('pending_tx and pending_nonce are in the row while the deposit is in flight, and cleared once mined', async () => {
    const chain = createFakeChain();
    const { test, quote, qid } = await prepared(createTestApp({ chain }));
    let during: Record<string, unknown> | undefined;
    chain.deposit.mockImplementationOnce(async (request, hooks) => {
      hooks?.onSigned?.({ hash: `0x${'d1'.repeat(32)}`, nonce: 12, replacement: false });
      during = rowOf(test, request.qid);
      chain.plantDeposit(request.qid);
      return { kind: 'mined' as const, hash: `0x${'d1'.repeat(32)}`, success: true, logs: [] };
    });
    await pay(test, quote, await signPayment(quote));

    expect(during).toMatchObject({
      stage: 'DEPOSITING',
      pending_tx: `0x${'d1'.repeat(32)}`,
      pending_nonce: 12,
    });
    expect(rowOf(test, qid)).toMatchObject({ pending_tx: null, pending_nonce: null });
  });

  it('an unknown outcome keeps pending_tx so recovery can resolve the deposit by nonce', async () => {
    const chain = createFakeChain();
    const { test, quote, qid } = await prepared(createTestApp({ chain }));
    chain.deposit.mockImplementationOnce(async (_request, hooks) => {
      hooks?.onSigned?.({ hash: `0x${'d2'.repeat(32)}`, nonce: 13, replacement: false });
      return { kind: 'unknown' as const, hash: `0x${'d2'.repeat(32)}` };
    });
    const response = await pay(test, quote, await signPayment(quote));
    expect(response.status).toBe(202);
    expect(rowOf(test, qid)).toMatchObject({ stage: 'DEPOSITING', pending_nonce: 13 });
  });
});

describe('a node that cannot be reached before anything is signed', () => {
  it('is 503 and "not charged": back to QUOTED, and the same signature can be sent again', async () => {
    const chain = createFakeChain();
    const { test, quote, qid } = await prepared(createTestApp({ chain }));
    const header = await signPayment(quote);
    chain.deposit.mockImplementationOnce(async () => ({
      kind: 'not-sent' as const,
      reason: 'rpc down',
      rpcDown: true,
    }));

    const first = await pay(test, quote, header);
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe('CHAIN_UNAVAILABLE');
    expect(stageOf(test, qid)).toBe('QUOTED');

    expect((await pay(test, quote, header)).status).toBe(200);
  });
});

describe('a stuck tx queue refuses new deposits (§5.6 C)', () => {
  it('503 before any money is taken, and the question stays QUOTED', async () => {
    const chain = createFakeChain();
    chain.txHealthy.mockReturnValue(false);
    const { test, quote, qid } = await prepared(createTestApp({ chain }));
    const response = await pay(test, quote, await signPayment(quote));

    expect(response.status).toBe(503);
    expect(chain.deposit).not.toHaveBeenCalled();
    expect(stageOf(test, qid)).toBe('QUOTED');
    expect(PRICE).toBeGreaterThan(0n);
  });
});
