'use client';

import { CircleAlert } from 'lucide-react';
import { getAddress } from 'viem';
import { useSwitchChain } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { TxLink } from '@/components/ui/TxLink';
import { useConnectDialog } from '@/components/wallet/connect-dialog-context';
import { useWalletStatus } from '@/components/wallet/use-wallet-status';
import { AVAX_FAUCET_URL, FUJI_CHAIN_ID } from '@/lib/constants';
import { formatUsdcVi, shortAddress } from '@/lib/format';
import { messages } from '@/lib/messages';
import type { ClaimState } from '../hooks';
import { askMessages } from '../messages';
import type { ClaimView } from '../result-view';

export const CLAIM_BUTTON_ID = 'claim-refund-button';

type Props = {
  claim: ClaimView;
  state: ClaimState;
  onClaim: () => void;
  // The chain's latest block time (unix seconds), only while "not yet" waits for the deadline.
  blockTime: number | undefined;
};

// The payer's way out when the server does not answer (design W5 §3.1). It never sends anything on
// its own: one click, one simulation, one wallet prompt. All reasoning is in `useClaimRefund`.
export function ClaimRefundPanel({ claim, state, onClaim, blockTime }: Props) {
  const wallet = useWalletStatus();
  const { openConnectDialog } = useConnectDialog();
  const { mutate: switchChain } = useSwitchChain();
  const { payer, amount } = claim;

  const sameWallet =
    wallet.kind === 'ready' &&
    payer !== undefined &&
    wallet.address.toLowerCase() === payer.toLowerCase();
  // The API sends lowercase addresses; show the checksummed form, like the wallet does.
  const payerText = payer === undefined ? undefined : shortAddress(getAddress(payer));
  const recipient =
    payerText === undefined
      ? undefined
      : wallet.kind === 'ready'
        ? sameWallet
          ? askMessages.claimToSelf(payerText)
          : askMessages.claimToPayer(payerText)
        : askMessages.claimToPayerOnly(payerText);

  const busy = state.kind === 'simulating' || state.kind === 'confirming';
  // After a tx went out or the question was closed, no button: it must not invite a second one.
  const done =
    state.kind === 'pending' || state.kind === 'refunded' || state.kind === 'alreadyClosed';

  return (
    <div className="mt-2 flex flex-col gap-2">
      {amount !== undefined && (
        <p className="font-medium">{askMessages.claimTitle(formatUsdcVi(amount))}</p>
      )}
      {recipient && <p>{recipient}</p>}

      {!done && (
        <div>
          {wallet.kind === 'loading' ? (
            <Skeleton className="h-10 w-full sm:w-56" />
          ) : wallet.kind === 'disconnected' || wallet.kind === 'connecting' ? (
            <Button
              id={CLAIM_BUTTON_ID}
              loading={wallet.kind === 'connecting'}
              onClick={openConnectDialog}
              className="w-full sm:w-auto"
            >
              {wallet.kind === 'connecting' ? messages.connecting : askMessages.connectToClaim}
            </Button>
          ) : wallet.kind === 'wrongNetwork' ? (
            <Button
              id={CLAIM_BUTTON_ID}
              onClick={() => switchChain({ chainId: FUJI_CHAIN_ID })}
              className="w-full sm:w-auto"
            >
              {askMessages.switchToFuji}
            </Button>
          ) : (
            <Button
              id={CLAIM_BUTTON_ID}
              loading={busy}
              disabled={state.kind === 'notYet'}
              onClick={onClaim}
              className="w-full sm:w-auto"
            >
              {state.kind === 'simulating'
                ? askMessages.claimChecking
                : state.kind === 'confirming'
                  ? askMessages.claimConfirm
                  : askMessages.claimButton}
            </Button>
          )}
        </div>
      )}

      {/* One polite region for everything the flow says; always mounted so a change is announced. */}
      <div role="status" aria-live="polite" className="flex min-h-5 flex-col gap-1 text-sm">
        <Status state={state} blockTime={blockTime} />
      </div>

      {!done && <p className="text-sm text-ink-muted">{askMessages.claimGasNote}</p>}
    </div>
  );
}

function Status({ state, blockTime }: { state: ClaimState; blockTime: number | undefined }) {
  switch (state.kind) {
    case 'idle':
      return state.rejected ? <p className="text-ink-muted">{askMessages.claimRejected}</p> : null;
    case 'simulating':
    case 'confirming':
    case 'refunded':
      return null;
    case 'pending':
      return (
        <>
          <p>{askMessages.claimPending}</p>
          <p>
            <TxLink hash={state.hash} label={askMessages.claimTxLabel} />
          </p>
          {state.slow && <p className="text-ink-muted">{askMessages.claimSlow}</p>}
        </>
      );
    case 'alreadyClosed':
      return (
        <>
          <p className="text-ink-muted">{askMessages.claimAlreadyClosed}</p>
          {state.wasted && <p className="text-ink-muted">{askMessages.claimTxNotNeeded}</p>}
        </>
      );
    case 'notYet': {
      const wait =
        state.deadline !== undefined && blockTime !== undefined
          ? Math.max(1, state.deadline - blockTime + 1)
          : undefined;
      return <p className="text-ink-muted">{askMessages.claimNotYet(wait ?? 5)}</p>;
    }
    case 'failed':
      return (
        <p className="flex gap-2 text-error">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {state.error === 'rpc'
              ? askMessages.claimRpcFailed
              : state.error === 'noGas'
                ? askMessages.claimNoGas
                : askMessages.claimFailed}
            {state.error === 'noGas' && (
              <>
                {' '}
                <a href={AVAX_FAUCET_URL} target="_blank" rel="noreferrer" className="underline">
                  {askMessages.getTestAvax} ↗{' '}
                  <span className="sr-only">{messages.opensInNewTab}</span>
                </a>
              </>
            )}
          </span>
        </p>
      );
  }
}
