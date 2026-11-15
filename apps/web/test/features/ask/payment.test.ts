import { fujiDeployment } from '@askpay/shared/abi';
import { paymentPayloadSchema, decodeHeader, paymentRequirementSchema } from '@askpay/shared/x402';
import { describe, expect, it } from 'vitest';
import {
  QUOTE_SAFETY_MARGIN_MS,
  buildAuthorization,
  buildPaymentHeader,
  buildQuote,
  buildTypedData,
  isQuoteExpired,
  isSignatureExpired,
  quoteMatchesDeployment,
} from '@/features/ask/payment';
import { ACCOUNT_A } from '../../helpers/wallet-harness';
import { QID, quoteBody } from '../../helpers/ask-api';

const requirement = (over: Parameters<typeof quoteBody>[0] = {}) =>
  paymentRequirementSchema.parse(quoteBody(over).accepts[0]);

describe('payment: header and typed data', () => {
  it('AP-03-AC01 W2-E04: the header decodes to nonce = qid, validAfter = 0, to = payTo and the quote verbatim', () => {
    const req = requirement();
    const authorization = buildAuthorization(req, ACCOUNT_A);
    const header = buildPaymentHeader(req, authorization, `0x${'cd'.repeat(65)}`);
    const decoded = decodeHeader(paymentPayloadSchema, header);
    expect(decoded?.payload.authorization).toMatchObject({
      from: ACCOUNT_A.toLowerCase(),
      to: fujiDeployment.address,
      value: '50000',
      validAfter: '0',
      nonce: QID,
    });
    expect(decoded?.accepted).toEqual(req);
  });

  it('signs EIP-3009 typed data with the token name and version from the quote on chain 43113', () => {
    const req = requirement();
    const typed = buildTypedData(req, buildAuthorization(req, ACCOUNT_A));
    expect(typed.domain).toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 43113,
      verifyingContract: req.asset,
    });
    expect(typed.primaryType).toBe('ReceiveWithAuthorization');
    expect(typed.message.value).toBe(50_000n);
  });
});

describe('payment: quote matches what the repo publishes', () => {
  it('accepts the deployed token and escrow', () => {
    expect(quoteMatchesDeployment(requirement())).toBe(true);
  });
  it('W2-E14: refuses another payee, another token or a zero amount', () => {
    expect(quoteMatchesDeployment(requirement({ payTo: `0x${'11'.repeat(20)}` }))).toBe(false);
    expect(quoteMatchesDeployment(requirement({ asset: `0x${'22'.repeat(20)}` }))).toBe(false);
    expect(quoteMatchesDeployment({ ...requirement(), amount: '0' })).toBe(false);
  });
  it('compares addresses case-insensitively', () => {
    const upper = {
      ...requirement(),
      payTo: fujiDeployment.address.toUpperCase().replace('0X', '0x'),
    };
    expect(quoteMatchesDeployment(upper)).toBe(true);
  });
});

describe('payment: quote deadlines use the server clock, not the user clock', () => {
  const T = 1_800_000_000_000; // local "now" when the quote arrives
  it('W2-E13: validBefore − Date = 300 s → expires 90 s early, at 210 s', () => {
    const req = requirement({ validBefore: T / 1000 + 300 });
    const quote = buildQuote(req, T, new Date(T).toUTCString());
    expect(quote.expiresAt).toBe(T + 300_000 - QUOTE_SAFETY_MARGIN_MS);
    expect(isQuoteExpired(quote, T + 209_000)).toBe(false);
    expect(isQuoteExpired(quote, T + 210_000)).toBe(true);
    expect(isSignatureExpired(quote, T + 299_000)).toBe(false);
    expect(isSignatureExpired(quote, T + 300_000)).toBe(true);
  });
  it('ignores a wrong user clock: only the gap between Date and validBefore counts', () => {
    // The server says it is 1000 s before validBefore - 300 s: the quote has 300 s from arrival.
    const serverNow = 5_000_000_000;
    const req = requirement({ validBefore: serverNow / 1000 + 300 });
    const quote = buildQuote(req, T, new Date(serverNow).toUTCString());
    expect(quote.validBeforeAt).toBe(T + 300_000);
  });
  it('falls back to maxTimeoutSeconds without a usable Date header', () => {
    const req = requirement({ validBefore: 2_000_000_000 });
    const quote = buildQuote(req, T, null);
    expect(quote.validBeforeAt).toBe(T + 300_000);
    expect(buildQuote(req, T, 'not a date').validBeforeAt).toBe(T + 300_000);
  });
});
