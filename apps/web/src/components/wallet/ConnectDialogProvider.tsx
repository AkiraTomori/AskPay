'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WALLET_BUTTON_ID } from '@/lib/constants';
import { ConnectDialog } from './ConnectDialog';
import { ConnectDialogContext } from './connect-dialog-context';

export function ConnectDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const focusRequest = useRef(false);
  const openConnectDialog = useCallback(() => setOpen(true), []);
  const closeConnectDialog = useCallback(() => setOpen(false), []);
  // After a successful connect the opener ("Kết nối ví") is gone, so the browser cannot restore
  // focus to it; hand focus to the account button once the dialog has closed.
  useEffect(() => {
    if (open || !focusRequest.current) return;
    focusRequest.current = false;
    document.getElementById(WALLET_BUTTON_ID)?.focus();
  }, [open]);
  const api = useMemo(
    () => ({ openConnectDialog, closeConnectDialog, focusRequest }),
    [openConnectDialog, closeConnectDialog],
  );
  return (
    <ConnectDialogContext value={api}>
      {children}
      <ConnectDialog open={open} onClose={closeConnectDialog} />
    </ConnectDialogContext>
  );
}
