import { fujiDeployment } from '@askpay/shared/abi';
import {
  FUJI_NETWORK,
  X402_VERSION,
  encodeHeader,
  receiveAuthorizationTypedData,
  type PaymentRequirement,
} from '@askpay/shared/x402';
import type { Address, Hex } from 'viem';

// Pure functions of the ask flow, testable without a wallet or a clock (design W2 §5, §6.5).

// The server rejects a signature whose validBefore is less than 60 s away. The client treats the
// quote as expired 90 s early: 60 s for the server plus 30 s for the wallet popup and the network.
export const QUOTE_SAFETY_MARGIN_MS = 90_000;

export type Quote = {
  requirement: PaymentRequirement; // accepts[0], kept verbatim
  receivedAt: number; // local clock, ms
  expiresAt: number; // local clock, ms: when the UI stops offering this quote
  validBeforeAt: number; // local clock, ms: when the signature can no longer be deposited
};

export type SignedPayment = { qid: Hex; header: string }; // base64, resendable byte for byte

// The user's clock is not trusted: deadlines are measured from the moment the quote arrived,
// against the server's own idea of "now" (the 402's Date header). Without a usable Date the quote
// is assumed to have been issued `maxTimeoutSeconds` before validBefore.
export function buildQuote(
  requirement: PaymentRequirement,
  receivedAt: number,
  dateHeader: string | null,
): Quote {
  const validBeforeMs = Number(requirement.extra.validBefore) * 1000;
  const parsedDate = dateHeader === null ? Number.NaN : Date.parse(dateHeader);
  const serverNow = Number.isNaN(parsedDate)
    ? validBeforeMs - requirement.maxTimeoutSeconds * 1000
    : parsedDate;
  const validBeforeAt = receivedAt + (validBeforeMs - serverNow);
  return {
    requirement,
    receivedAt,
    expiresAt: validBeforeAt - QUOTE_SAFETY_MARGIN_MS,
    validBeforeAt,
  };
}

export const isQuoteExpired = (quote: Quote, now: number) => now >= quote.expiresAt;
export const isSignatureExpired = (quote: Quote, now: number) => now >= quote.validBeforeAt;

// The signature moves money to `payTo`, so the web signs only for addresses this repo publishes.
export function quoteMatchesDeployment(requirement: PaymentRequirement): boolean {
  return (
    requirement.network === FUJI_NETWORK &&
    requirement.asset.toLowerCase() === fujiDeployment.token.toLowerCase() &&
    requirement.payTo.toLowerCase() === fujiDeployment.address.toLowerCase() &&
    BigInt(requirement.amount) > 0n
  );
}

export function buildAuthorization(requirement: PaymentRequirement, payer: Address) {
  return {
    from: payer,
    to: requirement.payTo as Address,
    value: BigInt(requirement.amount),
    validAfter: 0n,
    validBefore: BigInt(requirement.extra.validBefore),
    nonce: requirement.extra.qid as Hex,
  };
}

export type Authorization = ReturnType<typeof buildAuthorization>;

export function buildTypedData(requirement: PaymentRequirement, authorization: Authorization) {
  return receiveAuthorizationTypedData({
    tokenName: requirement.extra.tokenName,
    tokenVersion: requirement.extra.tokenVersion,
    asset: requirement.asset as Address,
    authorization,
  });
}

// PAYMENT-SIGNATURE header value. `accepted` echoes the quote exactly as received.
export function buildPaymentHeader(
  requirement: PaymentRequirement,
  authorization: Authorization,
  signature: Hex,
): string {
  return encodeHeader({
    x402Version: X402_VERSION,
    accepted: requirement,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  });
}
