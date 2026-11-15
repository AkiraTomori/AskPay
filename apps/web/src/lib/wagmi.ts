import { avalancheFuji } from 'wagmi/chains';
import { createConfig, http, type Config } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { RPC_URL } from './constants';

// Only Fuji, only injected wallets. EIP-6963 discovery stays on (the default), so Core and
// MetaMask appear as separate entries with their own name and icon even when both are installed.
export function createAskPayConfig(): Config {
  return createConfig({
    chains: [avalancheFuji],
    connectors: [injected()],
    transports: { [avalancheFuji.id]: http(RPC_URL) },
    ssr: true,
  });
}

export const wagmiConfig = createAskPayConfig();
