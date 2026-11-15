import { fujiDeployment } from '@askpay/shared/abi';

// The only chain AskPay runs on. Mainnet is forbidden unless the owner asks for it explicitly.
export const FUJI_CHAIN_ID = fujiDeployment.chainId;

// Default is publicnode: the Avalanche public RPC (api.avax-test.network) rate-limits by IP and
// answered a dev machine with Cloudflare 1015. Set NEXT_PUBLIC_RPC_URL in apps/web/.env.local to
// use another endpoint (one with an API key for anything real).
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://avalanche-fuji-c-chain-rpc.publicnode.com';

export const SNOWTRACE_BASE_URL = 'https://testnet.snowtrace.io';
export const FAUCET_URL = 'https://faucet.circle.com';
export const CORE_INSTALL_URL = 'https://core.app/';
export const METAMASK_INSTALL_URL = 'https://metamask.io/download/';

// The account button carries this id so other components can return focus to it.
export const WALLET_BUTTON_ID = 'wallet-button';
