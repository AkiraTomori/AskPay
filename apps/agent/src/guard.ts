// The agent holds the key, so it does not trust a quote blindly: if API_URL points at a stranger,
// nothing gets signed for a stranger's address (g1-buyer-agent §2).
import { parseUnits } from '@askpay/shared/money';
import {
  ESCROW_SCHEME,
  FUJI_NETWORK,
  X402_VERSION,
  type PaymentRequired,
} from '@askpay/shared/x402';

export const MAX_VALID_BEFORE_SECONDS = 3600;

export interface Deployment {
  address: string;
  token: string;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function checkQuote(
  quote: PaymentRequired,
  deployment: Deployment,
  nowSeconds: number,
): GuardResult {
  const requirement = quote.accepts[0];
  if (!requirement) return { ok: false, reason: 'quote has no payment option' };

  // The schema already pins these literals; they are widened so the check stays real if it changes.
  const version: number = quote.x402Version;
  const scheme: string = requirement.scheme;
  const network: string = requirement.network;
  if (version !== X402_VERSION) return { ok: false, reason: `unsupported x402 version ${version}` };
  if (scheme !== ESCROW_SCHEME) return { ok: false, reason: `unexpected scheme "${scheme}"` };
  if (network !== FUJI_NETWORK) return { ok: false, reason: `unexpected network "${network}"` };
  if (!same(requirement.payTo, deployment.address)) {
    return { ok: false, reason: 'payTo is not the AskPay escrow' };
  }
  if (!same(requirement.asset, deployment.token)) {
    return { ok: false, reason: 'asset is not the USDC token the escrow uses' };
  }

  let amount: bigint;
  let validBefore: bigint;
  try {
    amount = parseUnits(requirement.amount);
    validBefore = parseUnits(requirement.extra.validBefore);
  } catch {
    return { ok: false, reason: 'amount or validBefore is not a valid integer' };
  }
  if (amount <= 0n) return { ok: false, reason: 'amount must be greater than 0' };

  const now = BigInt(Math.floor(nowSeconds));
  if (validBefore <= now) return { ok: false, reason: 'validBefore has already passed' };
  if (validBefore > now + BigInt(MAX_VALID_BEFORE_SECONDS)) {
    return { ok: false, reason: 'validBefore is more than 1 hour away' };
  }
  return { ok: true };
}
