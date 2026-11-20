import { fujiDeployment } from '@askpay/shared/abi';

// The only chain AskPay runs on. Mainnet is forbidden unless the owner asks for it explicitly.
export const FUJI_CHAIN_ID = fujiDeployment.chainId;

// Default is publicnode: the Avalanche public RPC (api.avax-test.network) rate-limits by IP and
// answered a dev machine with Cloudflare 1015. Set NEXT_PUBLIC_RPC_URL in apps/web/.env.local to
// use another endpoint (one with an API key for anything real).
// `PUBLIC_RPC_URL` is the one /verify prints in its `cast` command, so a keyed endpoint set through
// NEXT_PUBLIC_RPC_URL is never shown on a page for strangers to copy.
export const PUBLIC_RPC_URL = 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? PUBLIC_RPC_URL;

// The repo is public at submission (W4 U-18), so a commit link is safe to show.
export const REPO_URL = 'https://github.com/AkiraTomori/AskPay';

export const SNOWTRACE_BASE_URL = 'https://testnet.snowtrace.io';
export const FAUCET_URL = 'https://faucet.circle.com';
// Core's testnet faucet: the same wallet the demo uses. Check it still works before the demo (W5 U-24).
export const AVAX_FAUCET_URL = 'https://core.app/tools/testnet-faucet/';
export const CORE_INSTALL_URL = 'https://core.app/';
export const METAMASK_INSTALL_URL = 'https://metamask.io/download/';

// The account button carries this id so other components can return focus to it.
export const WALLET_BUTTON_ID = 'wallet-button';
