import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  multicall3Abi,
  numberToHex,
  type Address,
  type Hex,
} from 'viem';
import { createConfig, type Config } from 'wagmi';
import { avalancheFuji, mainnet } from 'wagmi/chains';
import { mock } from 'wagmi/connectors';
import { AppShell } from '@/components/layout/AppShell';
import { Providers } from '@/app/providers';
import { messages } from '@/lib/messages';

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value in test');
  return value;
}

export const walletOf = (config: Config) => must(config.connectors[0]);

export const ACCOUNT_A: Address = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
export const ACCOUNT_B: Address = getAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');

type Options = {
  // The mock connector starts on chains[0], so this picks the wallet's initial network.
  startChainId?: 1 | 43113;
  // The production config knows only Fuji; the default adds mainnet so the mock wallet can start there.
  fujiOnly?: boolean;
  // Simulates a page reload: the wallet is already authorised and wagmi hydrates like in Next (SSR).
  reloadWithAuthorisedWallet?: boolean;
  connectError?: boolean | Error;
  switchChainError?: boolean | Error;
  // USDC balance per account, in base units; any other account reads 0.
  balances?: Partial<Record<Address, bigint>>;
};

export function createTestConfig({
  startChainId = 43113,
  fujiOnly = false,
  reloadWithAuthorisedWallet = false,
  connectError,
  switchChainError,
  balances = { [ACCOUNT_A]: 50_000n, [ACCOUNT_B]: 12_500_000n },
}: Options = {}): Config {
  const lower = new Map(Object.entries(balances).map(([a, v]) => [a.toLowerCase(), v]));
  const balanceOf = (callData: string) =>
    numberToHex(lower.get(`0x${callData.slice(-40)}`.toLowerCase()) ?? 0n, { size: 32 });
  // wagmi batches reads through Multicall3 on chains that have it, so the fake RPC answers an
  // aggregate3 of balanceOf(address) calls (the 32-byte argument ends with the 20-byte address).
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method !== 'eth_call') throw new Error(`Unexpected RPC call in test: ${method}`);
      const { data } = must((params as { data: Hex }[])[0]);
      const { args } = decodeFunctionData({ abi: multicall3Abi, data });
      const calls = args[0] as readonly { callData: Hex }[];
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: 'aggregate3',
        result: calls.map((call) => ({
          success: true,
          returnData: balanceOf(call.callData) as Hex,
        })),
      });
    },
  });
  return createConfig({
    chains: fujiOnly
      ? [avalancheFuji]
      : startChainId === 1
        ? [mainnet, avalancheFuji]
        : [avalancheFuji, mainnet],
    connectors: [
      mock({
        accounts: [ACCOUNT_A],
        features: {
          ...(reloadWithAuthorisedWallet && { defaultConnected: true, reconnect: true }),
          ...(connectError !== undefined && { connectError }),
          ...(switchChainError !== undefined && { switchChainError }),
        },
      }),
    ],
    transports: { [mainnet.id]: transport, [avalancheFuji.id]: transport },
    ssr: reloadWithAuthorisedWallet,
  });
}

export function renderShell(config: Config, page: ReactNode = <p>nội dung trang</p>) {
  return {
    user: userEvent.setup(),
    ...render(
      <Providers config={config}>
        <AppShell>{page}</AppShell>
      </Providers>,
    ),
  };
}

export const walletButtonName = (address: Address) =>
  new RegExp(`^${address.slice(0, 6)}…${address.slice(-4)}`);

// Opens the dialog from the header button and picks the mock wallet.
export async function connectWithUi(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: messages.connect }));
  const dialog = await screen.findByRole('dialog');
  await user.click(await within(dialog).findByRole('button', { name: /Mock Connector/ }));
}
