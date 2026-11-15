import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  UserRejectedRequestError,
  multicall3Abi,
  numberToHex,
  type Address,
  type Hex,
} from 'viem';
import { useRouter } from 'next/navigation';
import { createConfig, type Config, type CreateConnectorFn } from 'wagmi';
import { avalancheFuji, mainnet } from 'wagmi/chains';
import { mock } from 'wagmi/connectors';
import { AppShell } from '@/components/layout/AppShell';
import { Providers } from '@/app/providers';
import { messages } from '@/lib/messages';

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value in test');
  return value;
}

// What the fake wallet saw and how it should answer `eth_signTypedData_v4`. The mock connector
// forwards signing to a real HTTP RPC, so the harness answers it itself (module state, reset by
// every createTestConfig).
export const signing = {
  requests: [] as { account: string; typedData: Record<string, unknown> }[],
  signature: `0x${'ab'.repeat(65)}` as Hex,
  gate: undefined as Promise<void> | undefined,
  hold() {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  },
  release: (() => {}) as () => void,
};

// Balance reads served by the fake RPC (tests assert a payment refreshes the balance).
export const rpcStats = { balanceReads: 0 };

function withFakeSigning(create: CreateConnectorFn, error: boolean | Error | undefined) {
  const wrapped: CreateConnectorFn = (config) => {
    const connector = create(config);
    const getProvider = connector.getProvider.bind(connector);
    connector.getProvider = async (parameters) => {
      const provider = (await getProvider(parameters)) as {
        request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      };
      const request = provider.request;
      return {
        ...provider,
        request: async (args: { method: string; params?: unknown }) => {
          if (args.method !== 'eth_signTypedData_v4') return request(args);
          const [account, json] = args.params as [string, string];
          signing.requests.push({
            account,
            typedData: JSON.parse(json) as Record<string, unknown>,
          });
          if (signing.gate) await signing.gate;
          if (error) {
            throw error === true ? new UserRejectedRequestError(new Error('rejected')) : error;
          }
          return signing.signature;
        },
      };
    };
    return connector;
  };
  return wrapped;
}

// The mocked router's push (test/setup.ts): the same spy every component gets.
export const routerPush = () => useRouter().push;

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
  // true: the user rejects the signature (code 4001); an Error: that error is thrown instead.
  signTypedDataError?: boolean | Error;
  // The fake RPC fails every balance read: the web cannot know the balance (usdc = undefined).
  balanceError?: boolean;
  // USDC balance per account, in base units; any other account reads 0.
  balances?: Partial<Record<Address, bigint>>;
};

export function createTestConfig({
  startChainId = 43113,
  fujiOnly = false,
  reloadWithAuthorisedWallet = false,
  connectError,
  switchChainError,
  signTypedDataError,
  balanceError = false,
  balances = { [ACCOUNT_A]: 50_000n, [ACCOUNT_B]: 12_500_000n },
}: Options = {}): Config {
  signing.requests = [];
  signing.gate = undefined;
  rpcStats.balanceReads = 0;
  const lower = new Map(Object.entries(balances).map(([a, v]) => [a.toLowerCase(), v]));
  const balanceOf = (callData: string) =>
    numberToHex(lower.get(`0x${callData.slice(-40)}`.toLowerCase()) ?? 0n, { size: 32 });
  // wagmi batches reads through Multicall3 on chains that have it, so the fake RPC answers an
  // aggregate3 of balanceOf(address) calls (the 32-byte argument ends with the 20-byte address).
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method !== 'eth_call') throw new Error(`Unexpected RPC call in test: ${method}`);
      rpcStats.balanceReads += 1;
      if (balanceError) throw new Error('RPC down');
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
      withFakeSigning(
        mock({
          accounts: [ACCOUNT_A],
          features: {
            ...(reloadWithAuthorisedWallet && { defaultConnected: true, reconnect: true }),
            ...(connectError !== undefined && { connectError }),
            ...(switchChainError !== undefined && { switchChainError }),
          },
        }),
        signTypedDataError,
      ),
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
