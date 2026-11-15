import { useContext, useSyncExternalStore } from 'react';
import type { Address } from 'viem';
import { useConnection } from 'wagmi';
import { FUJI_CHAIN_ID } from '@/lib/constants';
import { ReconnectSettledContext } from './reconnect-context';
import { useUsdcBalance } from './use-usdc-balance';

// Wallet state as one tagged union, shared by W1-W5 (design W1 §5).
export type WalletStatus =
  | { kind: 'loading' } // not hydrated yet, or the reconnect on page load has not finished
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'wrongNetwork'; address: Address; chainId: number }
  | { kind: 'ready'; address: Address; usdc: bigint | undefined }; // undefined: loading or failed

const noopSubscribe = () => () => {};

// False during SSR and hydration, true afterwards. Until then wagmi can only report
// "disconnected", which would flash "Kết nối ví" before the reconnect starts.
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useWalletStatus(): WalletStatus {
  const hydrated = useHydrated();
  const reconnectSettled = useContext(ReconnectSettledContext);
  const { status, address, chainId } = useConnection();
  const balance = useUsdcBalance();

  if (!hydrated || !reconnectSettled || status === 'reconnecting') return { kind: 'loading' };
  if (status === 'connecting') return { kind: 'connecting' };
  if (status === 'disconnected') return { kind: 'disconnected' };
  // Detect the wrong network from the *connection's* chain: the config has only Fuji, so
  // useChainId() would always say Fuji.
  if (chainId !== FUJI_CHAIN_ID) return { kind: 'wrongNetwork', address, chainId };
  return { kind: 'ready', address, usdc: balance.data };
}
