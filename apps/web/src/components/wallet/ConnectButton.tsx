'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { WALLET_BUTTON_ID } from '@/lib/constants';
import { messages } from '@/lib/messages';
import { AccountMenu } from './AccountMenu';
import { useConnectDialog } from './connect-dialog-context';
import { useUsdcBalance } from './use-usdc-balance';
import { useWalletStatus } from './use-wallet-status';

export function ConnectButton() {
  const status = useWalletStatus();
  const { isError: balanceFailed } = useUsdcBalance();
  const { openConnectDialog } = useConnectDialog();

  // Disconnecting (from the menu or inside the wallet) replaces the account button with this one;
  // without this, focus would fall back to <body>.
  const previousKind = useRef(status.kind);
  useEffect(() => {
    const wasConnected =
      previousKind.current === 'ready' || previousKind.current === 'wrongNetwork';
    previousKind.current = status.kind;
    if (
      status.kind === 'disconnected' &&
      wasConnected &&
      document.activeElement === document.body
    ) {
      document.getElementById(WALLET_BUTTON_ID)?.focus();
    }
  }, [status.kind]);

  switch (status.kind) {
    case 'loading':
      // Same size as the button, so nothing jumps when the reconnect resolves.
      return <Skeleton className="h-10 w-28" />;
    case 'disconnected':
      return (
        <Button id={WALLET_BUTTON_ID} onClick={openConnectDialog}>
          {messages.connect}
        </Button>
      );
    case 'connecting':
      return <Button loading>{messages.connecting}</Button>;
    case 'wrongNetwork':
      // A balance on another chain would be misleading, so it is hidden.
      return <AccountMenu address={status.address} balance={{ kind: 'hidden' }} />;
    case 'ready':
      return (
        <AccountMenu
          address={status.address}
          balance={
            status.usdc !== undefined
              ? { kind: 'value', usdc: status.usdc }
              : balanceFailed
                ? { kind: 'error' }
                : { kind: 'loading' }
          }
        />
      );
  }
}
