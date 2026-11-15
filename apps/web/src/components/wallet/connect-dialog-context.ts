'use client';

import { createContext, useContext, type RefObject } from 'react';

export type ConnectDialogApi = {
  openConnectDialog: () => void;
  closeConnectDialog: () => void;
  // Set when a connect succeeds; once the dialog has closed, focus moves to the account button.
  focusRequest: RefObject<boolean>;
};

export const ConnectDialogContext = createContext<ConnectDialogApi | null>(null);

// W2's "Kết nối ví để hỏi" button calls openConnectDialog() to open this same dialog.
export function useConnectDialog(): ConnectDialogApi {
  const api = useContext(ConnectDialogContext);
  if (!api) throw new Error('useConnectDialog must be used inside <Providers>');
  return api;
}
