import { describe, expect, it } from 'vitest';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fujiDeployment } from '../src/abi/deployments.js';
import { verdictTypedData } from '../src/verdict.js';

const qid: `0x${string}` = `0x${'9f'.repeat(32)}`;
const answerHash: `0x${string}` = `0x${'01'.repeat(32)}`;
const citationsHash: `0x${string}` = `0x${'02'.repeat(32)}`;
const escrow = fujiDeployment.address;

// Read from the deployed contract on Fuji (14/11/2026) with a read-only eth_call, no key and no
// transaction: cast call <escrow> "verdictDigest(bytes32,bytes32,bytes32,bool)(bytes32)" <qid>
// <answerHash> <citationsHash> <pass>. If the contract is redeployed with another name, version or
// field order, these constants and the typed data must change together.
const ON_CHAIN_DIGEST = {
  true: '0x1344089d88a7d17b4f6622cd71067dfacc9935d5db8cf1681d3201210c7a11c3',
  false: '0x748169fc7ed2eb69c8249268a7e604613dd53a3e3c7b0eca0d7c54d4dde1d014',
} as const;

describe('verdictTypedData', () => {
  it.each([true, false])(
    'hashes to the digest the deployed contract returns for pass=%s (AP-05-AC05)',
    (pass) => {
      const typed = verdictTypedData({ escrow, qid, answerHash, citationsHash, pass });
      expect(hashTypedData(typed)).toBe(ON_CHAIN_DIGEST[String(pass) as 'true' | 'false']);
    },
  );

  it('is bound to the escrow address, so another deployment would not accept the signature', () => {
    const other = '0x000000000000000000000000000000000000dEaD';
    const here = verdictTypedData({ escrow, qid, answerHash, citationsHash, pass: true });
    const there = verdictTypedData({ escrow: other, qid, answerHash, citationsHash, pass: true });
    expect(hashTypedData(here)).not.toBe(hashTypedData(there));
  });

  it('recovers the signer from a signature over it', async () => {
    const checker = privateKeyToAccount(`0x${'33'.repeat(32)}`);
    const typed = verdictTypedData({ escrow, qid, answerHash, citationsHash, pass: true });
    const signature = await checker.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(checker.address);
  });
});
