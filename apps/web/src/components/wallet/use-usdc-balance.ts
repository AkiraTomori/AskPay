import { fujiDeployment } from '@askpay/shared/abi';
import { erc20Abi, zeroAddress } from 'viem';
import { useConnection, useReadContract } from 'wagmi';
import { FUJI_CHAIN_ID } from '@/lib/constants';

// USDC balance of the connected account on Fuji. `chainId` is pinned, so the read never follows
// the wallet to another chain; it is simply disabled while the wallet is on the wrong one.
// react-query refetches on window focus; W2 invalidates this query after a payment.
export function useUsdcBalance() {
  const { address, chainId, status } = useConnection();
  return useReadContract({
    abi: erc20Abi,
    address: fujiDeployment.token,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: FUJI_CHAIN_ID,
    query: {
      enabled: status === 'connected' && chainId === FUJI_CHAIN_ID && address !== undefined,
    },
  });
}
