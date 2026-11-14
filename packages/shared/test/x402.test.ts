import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { z } from 'zod';
import {
  FUJI_NETWORK,
  decodeHeader,
  encodeHeader,
  paymentPayloadSchema,
  receiveAuthorizationTypedData,
} from '../src/x402.js';

const qid: `0x${string}` = `0x${'9f'.repeat(32)}`;
const escrow = '0x869e95576f6dd6f06118cf733b4f307ae37ddce0' as const;
const usdc = '0x5425890298aed601595a70ab815c96711a31bc65' as const;
const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`);

describe('x402 headers', () => {
  it('round-trips JSON with Vietnamese text through base64', () => {
    const value = { description: 'Một câu trả lời có trích dẫn Bộ luật Lao động 2019' };
    expect(decodeHeader(z.object({ description: z.string() }), encodeHeader(value))).toEqual(value);
  });

  it('returns undefined for garbage, missing and wrong-shape headers', () => {
    expect(decodeHeader(paymentPayloadSchema, undefined)).toBeUndefined();
    expect(decodeHeader(paymentPayloadSchema, '%%%not-base64%%%')).toBeUndefined();
    expect(decodeHeader(paymentPayloadSchema, encodeHeader({ hello: 'world' }))).toBeUndefined();
  });
});

describe('paymentPayloadSchema', () => {
  const payload = (from: string) => ({
    x402Version: 2,
    accepted: {
      scheme: 'escrow',
      network: FUJI_NETWORK,
      asset: usdc,
      amount: '50000',
      payTo: escrow,
      extra: { qid },
    },
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: {
        from,
        to: escrow,
        value: '50000',
        validAfter: '0',
        validBefore: '1762700000',
        nonce: qid,
      },
    },
  });

  it('accepts a checksummed address and normalises it to lowercase', () => {
    const parsed = paymentPayloadSchema.parse(payload(payer.address));
    expect(parsed.payload.authorization.from).toBe(payer.address.toLowerCase());
  });

  it('rejects a short signature and a malformed address', () => {
    const bad = payload('0x1234');
    expect(paymentPayloadSchema.safeParse(bad).success).toBe(false);
    const shortSig = payload(payer.address);
    shortSig.payload.signature = '0xabcd';
    expect(paymentPayloadSchema.safeParse(shortSig).success).toBe(false);
  });
});

describe('receiveAuthorizationTypedData', () => {
  it('produces typed data whose signature verifies against the payer', async () => {
    const typed = receiveAuthorizationTypedData({
      tokenName: 'USD Coin',
      tokenVersion: '2',
      asset: usdc,
      authorization: {
        from: payer.address,
        to: escrow,
        value: 50000n,
        validAfter: 0n,
        validBefore: 1762700000n,
        nonce: qid,
      },
    });
    const signature = await payer.signTypedData(typed);
    expect(await verifyTypedData({ ...typed, address: payer.address, signature })).toBe(true);
    expect(typed.domain.chainId).toBe(43113);
  });
});
