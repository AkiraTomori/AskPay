'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider, type Config } from 'wagmi';
import { ReconnectGate } from '@/components/wallet/ReconnectGate';
import { ConnectDialogProvider } from '@/components/wallet/ConnectDialogProvider';
import { wagmiConfig } from '@/lib/wagmi';

// `config` is injectable so tests can run with a mock wallet; production uses the Fuji-only one.
export function Providers({
  children,
  config = wagmiConfig,
}: {
  children: ReactNode;
  config?: Config;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ReconnectGate>
          <ConnectDialogProvider>{children}</ConnectDialogProvider>
        </ReconnectGate>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
