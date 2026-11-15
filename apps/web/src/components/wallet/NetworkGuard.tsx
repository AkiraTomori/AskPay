'use client';

import { TriangleAlert } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { useSwitchChain } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { FUJI_CHAIN_ID, WALLET_BUTTON_ID } from '@/lib/constants';
import { messages } from '@/lib/messages';
import { classifyWalletError } from '@/lib/wallet-errors';
import { useWalletStatus } from './use-wallet-status';

const GUARD_ID = 'network-guard';

// The live region stays mounted (empty) so screen readers announce the bar when it appears.
// It is not dismissible: on the wrong network every payment action would fail.
export function NetworkGuard() {
  const status = useWalletStatus();
  return <div role="status">{status.kind === 'wrongNetwork' && <WrongNetworkBar />}</div>;
}

function WrongNetworkBar() {
  const { mutate: switchChain, isPending, error } = useSwitchChain();
  const kind = error ? classifyWalletError(error) : undefined;

  // When the bar goes away (switched here, or in the wallet) focus must not fall back to <body>.
  useLayoutEffect(
    () => () => {
      const active = document.activeElement;
      const bar = document.getElementById(GUARD_ID);
      if (active === document.body || (bar && active && bar.contains(active))) {
        document.getElementById(WALLET_BUTTON_ID)?.focus();
      }
    },
    [],
  );

  return (
    <div id={GUARD_ID} className="border-l-[3px] border-refund bg-refund/12 px-4 py-3 text-ink">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
        <TriangleAlert aria-hidden className="size-5 shrink-0 text-refund" />
        <p className="flex-1">{messages.wrongNetwork}</p>
        <Button loading={isPending} onClick={() => switchChain({ chainId: FUJI_CHAIN_ID })}>
          {isPending ? messages.switching : messages.switchToFuji}
        </Button>
        {error && (
          <p className="basis-full">
            {kind === 'rejected'
              ? messages.switchRejected
              : kind === 'pending'
                ? messages.requestPending
                : messages.switchUnsupported}
          </p>
        )}
      </div>
    </div>
  );
}
