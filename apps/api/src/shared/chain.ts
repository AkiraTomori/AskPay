// One viem public client and one wallet client for the whole process (backend.md §1). The wallet is
// the provider wallet: the only key this process holds in A4.
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import type { Config } from './config.js';

// Explicit types: the inferred client type is too large for the compiler to write into .d.ts files.
export interface ChainClients {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
}

export function createChainClients(config: Config): ChainClients {
  const account = privateKeyToAccount(config.providerPrivateKey);
  const transport = http(config.rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain: avalancheFuji, transport }),
    walletClient: createWalletClient({ account, chain: avalancheFuji, transport }),
  };
}
