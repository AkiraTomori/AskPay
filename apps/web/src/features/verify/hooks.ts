'use client';

import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import { BLLD_2019_LAW_ID } from '@askpay/shared/leaf';
import { useReadContract, useReadContracts } from 'wagmi';
import { FUJI_CHAIN_ID } from '@/lib/constants';
import type { ChainRoot } from './verify-view';

// The browser reads the contract itself with the public client: no wallet, no AskPay server.
const READ = { retry: 1, retryDelay: 500 } as const;

export function useOnChainLaw(): { root: ChainRoot; retry: () => void } {
  const read = useReadContract({
    abi: askPayEscrowAbi,
    address: fujiDeployment.address,
    functionName: 'lawRoot',
    args: [BLLD_2019_LAW_ID],
    chainId: FUJI_CHAIN_ID,
    query: READ,
  });
  const { refetch } = read;
  const retry = () => void refetch();
  if (read.data !== undefined) return { root: { kind: 'data', root: read.data }, retry };
  if (read.isError) return { root: { kind: 'failed' }, retry };
  return { root: { kind: 'loading' }, retry };
}

export type OnChainRoles = {
  provider: `0x${string}` | undefined;
  checker: `0x${string}` | undefined;
  answerWindow: number | undefined;
  loading: boolean;
};

// Three small reads; a read that failed is `undefined` and the card falls back to the deployments file.
export function useOnChainRoles(): OnChainRoles {
  const base = { abi: askPayEscrowAbi, address: fujiDeployment.address, chainId: FUJI_CHAIN_ID };
  const read = useReadContracts({
    contracts: [
      { ...base, functionName: 'provider' },
      { ...base, functionName: 'checker' },
      { ...base, functionName: 'answerWindow' },
    ],
    query: READ,
  });
  const [provider, checker, window] = read.data ?? [];
  return {
    provider: provider?.status === 'success' ? provider.result : undefined,
    checker: checker?.status === 'success' ? checker.result : undefined,
    answerWindow: window?.status === 'success' ? Number(window.result) : undefined,
    loading: read.isLoading,
  };
}
