import type { Address, Hex } from 'viem';
import { verifyMessages } from './messages';

// Pure reasoning for /verify (design W5 §5.3, §5.4). The browser compares the two roots itself; the
// AskPay server is never asked, so the viewer does not have to trust it at the step they are checking.

export const ZERO_ROOT: Hex = `0x${'00'.repeat(32)}`;

// What the contract read gave: nothing yet, a failure, or the root.
export type ChainRoot = { kind: 'loading' } | { kind: 'failed' } | { kind: 'data'; root: Hex };

export type LawVerdict =
  | { kind: 'loading' }
  | { kind: 'failed' } // no ✓ and no ✗: the page does not know
  | { kind: 'match' }
  | { kind: 'mismatch' }
  | { kind: 'unregistered' };

export function lawVerdict(repoRoot: Hex, chain: ChainRoot): LawVerdict {
  if (chain.kind !== 'data') return { kind: chain.kind };
  const onChain = chain.root.toLowerCase();
  if (onChain === ZERO_ROOT) return { kind: 'unregistered' };
  return { kind: onChain === repoRoot.toLowerCase() ? 'match' : 'mismatch' };
}

// 600 -> "10 phút"; 90 -> "90 giây" (only whole minutes are said in minutes).
export function formatAnswerWindow(seconds: number): string {
  return seconds > 0 && seconds % 60 === 0
    ? verifyMessages.minutes(seconds / 60)
    : verifyMessages.seconds(seconds);
}

export type RoleView = {
  address: Address;
  // `chain`: read from the contract. `deployments`: the contract could not be read, so this is the
  // file in the repo, and the page says so.
  source: 'chain' | 'deployments';
  // The contract names someone else than the repo's deployments file (setProvider/setChecker ran).
  differs: boolean;
};

// The chain wins (P2): when it was read, show its value and say if the repo's file disagrees.
export function roleView(onChain: Address | undefined, inRepo: Address): RoleView {
  if (onChain === undefined) return { address: inRepo, source: 'deployments', differs: false };
  return {
    address: onChain,
    source: 'chain',
    differs: onChain.toLowerCase() !== inRepo.toLowerCase(),
  };
}
