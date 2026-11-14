// The checker's EIP-712 verdict (contracts.md §3, system-design §5.4). The checker signs it in
// apps/api; the escrow contract recovers the signer in `settle`. Both sides must hash the same
// domain and the same field order, so the definition lives here, next to the other wire formats,
// and a test pins `hashTypedData` to the digest the deployed contract returns (`verdictDigest`).
import type { Hex } from 'viem';
import { FUJI_CHAIN_ID } from './x402.js';

// Must equal `EIP712("AskPayEscrow", "1")` in the contract constructor.
export const VERDICT_DOMAIN_NAME = 'AskPayEscrow';
export const VERDICT_DOMAIN_VERSION = '1';

// Must equal VERDICT_TYPEHASH: "Verdict(bytes32 qid,bytes32 answerHash,bytes32 citationsHash,bool pass)".
export const VERDICT_TYPES = {
  Verdict: [
    { name: 'qid', type: 'bytes32' },
    { name: 'answerHash', type: 'bytes32' },
    { name: 'citationsHash', type: 'bytes32' },
    { name: 'pass', type: 'bool' },
  ],
} as const;

export interface VerdictInput {
  // The escrow contract is the verifying contract: a verdict signed for one deployment is useless
  // on another.
  escrow: Hex;
  qid: Hex;
  answerHash: Hex;
  citationsHash: Hex;
  pass: boolean;
}

export function verdictTypedData(input: VerdictInput) {
  return {
    domain: {
      name: VERDICT_DOMAIN_NAME,
      version: VERDICT_DOMAIN_VERSION,
      chainId: FUJI_CHAIN_ID,
      verifyingContract: input.escrow,
    },
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: {
      qid: input.qid,
      answerHash: input.answerHash,
      citationsHash: input.citationsHash,
      pass: input.pass,
    },
  } as const;
}
