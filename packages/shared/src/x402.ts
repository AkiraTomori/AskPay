// x402 v2 "escrow" scheme: the 402 quote, the PAYMENT-SIGNATURE payload and the EIP-3009 typed
// data both sides sign and verify (api.md §3, system-design §4). One definition, so the server,
// the web and the scripts cannot drift apart.
import { z } from 'zod';
import { amountSchema, bytes32Schema, addressSchema } from './api.js';

export const X402_VERSION = 2;
export const ESCROW_SCHEME = 'escrow';
export const FUJI_CHAIN_ID = 43113;
export const FUJI_NETWORK = `eip155:${FUJI_CHAIN_ID}`;
export const RECEIVE_AUTHORIZATION = 'ReceiveWithAuthorization';

// Wallets and viem send checksummed (mixed-case) addresses, while the API speaks lowercase
// (api.md §1). Incoming data is accepted in any case and normalised once, here.
const lowerHex = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`), `expected ${bytes}-byte hex`)
    .transform((value) => value.toLowerCase() as `0x${string}`);

export const anyCaseAddressSchema = lowerHex(20);
export const anyCaseBytes32Schema = lowerHex(32);
export const signatureSchema = lowerHex(65);

// --- 402 response and PAYMENT-REQUIRED header (api.md §3.1) -----------------------------------

export const paymentRequirementSchema = z.object({
  scheme: z.literal(ESCROW_SCHEME),
  network: z.literal(FUJI_NETWORK),
  asset: addressSchema,
  amount: amountSchema,
  payTo: addressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.object({
    qid: bytes32Schema,
    authorization: z.literal(RECEIVE_AUTHORIZATION),
    tokenName: z.string(),
    tokenVersion: z.string(),
    validBefore: amountSchema,
    answerWindowSeconds: z.number().int().positive(),
  }),
});
export type PaymentRequirement = z.infer<typeof paymentRequirementSchema>;

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.literal('PAYMENT_REQUIRED'),
  resource: z.object({ url: z.string(), description: z.string() }),
  accepts: z.array(paymentRequirementSchema).min(1),
});
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

// --- PAYMENT-SIGNATURE header (api.md §3.2) ---------------------------------------------------

export const authorizationSchema = z.object({
  from: anyCaseAddressSchema,
  to: anyCaseAddressSchema,
  value: amountSchema,
  validAfter: amountSchema,
  validBefore: amountSchema,
  nonce: anyCaseBytes32Schema,
});
export type Authorization = z.infer<typeof authorizationSchema>;

export const paymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  // The client echoes the requirement it accepted. Extra fields are ignored; the server compares
  // only what decides where the money goes.
  accepted: z.looseObject({
    scheme: z.literal(ESCROW_SCHEME),
    network: z.string(),
    asset: anyCaseAddressSchema,
    amount: amountSchema,
    payTo: anyCaseAddressSchema,
    extra: z.looseObject({ qid: anyCaseBytes32Schema }),
  }),
  payload: z.object({ signature: signatureSchema, authorization: authorizationSchema }),
});
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;

// PAYMENT-RESPONSE header. `settleTransaction` appears once the answer is settled (A5).
export const paymentResponseSchema = z.object({
  success: z.boolean(),
  network: z.literal(FUJI_NETWORK),
  transaction: bytes32Schema.optional(),
  settleTransaction: bytes32Schema.optional(),
});
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

// --- Header encoding: base64 of UTF-8 JSON ----------------------------------------------------

export function encodeHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Returns undefined for anything that is not valid base64 JSON matching the schema.
export function decodeHeader<T extends z.ZodType>(
  schema: T,
  header: string | undefined,
): z.output<T> | undefined {
  if (!header) return undefined;
  try {
    const bytes = Uint8Array.from(atob(header), (char) => char.charCodeAt(0));
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// --- EIP-3009 typed data ----------------------------------------------------------------------

export const RECEIVE_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface ReceiveAuthorizationInput {
  tokenName: string;
  tokenVersion: string;
  asset: `0x${string}`;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: `0x${string}`;
  };
}

// The domain comes from the token's own name() and version() (api.md §3.1), never hard-coded.
export function receiveAuthorizationTypedData(input: ReceiveAuthorizationInput) {
  return {
    domain: {
      name: input.tokenName,
      version: input.tokenVersion,
      chainId: FUJI_CHAIN_ID,
      verifyingContract: input.asset,
    },
    types: RECEIVE_AUTHORIZATION_TYPES,
    primaryType: RECEIVE_AUTHORIZATION,
    message: input.authorization,
  } as const;
}
