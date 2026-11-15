import { fujiDeployment } from '@askpay/shared/abi';

// The only chain AskPay runs on. Mainnet is forbidden unless the owner asks for it explicitly.
export const FUJI_CHAIN_ID = fujiDeployment.chainId;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc';

export const SNOWTRACE_BASE_URL = 'https://testnet.snowtrace.io';
export const FAUCET_URL = 'https://faucet.circle.com';
export const CORE_INSTALL_URL = 'https://core.app/';
export const METAMASK_INSTALL_URL = 'https://metamask.io/download/';

// The account button carries this id so other components can return focus to it.
export const WALLET_BUTTON_ID = 'wallet-button';
