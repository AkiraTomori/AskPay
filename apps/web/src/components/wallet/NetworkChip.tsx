'use client';

import { TriangleAlert } from 'lucide-react';
import { messages } from '@/lib/messages';
import { useWalletStatus } from './use-wallet-status';

// Shows which network the wallet is on. Colour is never the only signal: dot or icon plus text.
export function NetworkChip() {
  const status = useWalletStatus();
  if (status.kind === 'ready') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full sm:gap-1.5 border border-rule bg-surface px-2 py-1 sm:px-2.5 text-xs font-medium">
        <span aria-hidden className="size-2 rounded-full bg-paid" />
        {messages.fujiChip}
      </span>
    );
  }
  if (status.kind === 'wrongNetwork') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full sm:gap-1.5 border border-refund bg-refund/12 px-2 py-1 sm:px-2.5 text-xs font-medium text-ink">
        <TriangleAlert aria-hidden className="size-3.5 text-refund" />
        {messages.wrongNetworkChip}
      </span>
    );
  }
  return null;
}
