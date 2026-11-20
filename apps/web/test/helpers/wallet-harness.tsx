import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import {
  custom,
  decodeFunctionData,
  RpcRequestError,
  encodeErrorResult,
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
          if (args.method === 'eth_sendTransaction') {
            const [tx] = args.params as { from: string; to: string; data: string }[];
            chainFixture.sent.push({
              from: tx?.from ?? '',
              to: tx?.to ?? '',
              data: tx?.data ?? '',
            });
            if (signing.gate) await signing.gate;
            if (chainFixture.sendError) throw chainFixture.sendError;
            return chainFixture.sendHash;
          }
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

// The chain as the fake RPC shows it (W5): the escrow's `questions`, the latest block, receipts, and
// what the wallet was asked to send. Module state like `signing`, reset by every createTestConfig.
export type ChainQuestion = {
  payer: Address;
  amount: bigint;
  deadline: number;
  status: 'None' | 'Open' | 'Paid' | 'Refunded';
};
export type ReceiptFixture = {
  status: 'success' | 'reverted';
  logs: {
    address: Address;
    topics: readonly Hex[];
    data: Hex;
  }[];
};
// The latest block's time in the fake chain: 15/11/2026 14:00 UTC (21:00 in Vietnam).
export const BLOCK_TIME = Math.floor(Date.UTC(2026, 10, 15, 14, 0, 0) / 1000);
export const chainFixture = {
  questions: new Map<string, ChainQuestion>(),
  blockTime: BLOCK_TIME,
  // Every read of the escrow fails like a node that is down.
  readsFail: false,
  // The latest block cannot be read.
  blockFails: false,
  // What simulating claimRefund does: succeed (undefined), revert with a custom error, or fail like a node.
  simulate: undefined as undefined | 'QuestionNotOpen' | 'DeadlineNotReached' | 'rpc',
  receipts: new Map<string, ReceiptFixture>(),
  // eth_sendTransaction calls the wallet received.
  sent: [] as { from: string; to: string; data: string }[],
  sendHash: `0x${'c1'.repeat(32)}` as Hex,
  sendError: undefined as Error | undefined,
  // What /verify reads from the contract.
  lawRoot: `0x${'00'.repeat(32)}` as Hex,
  provider: fujiDeployment.provider as Address,
  checker: fujiDeployment.checker as Address,
  answerWindow: 600n,
  rolesFail: false,
  reads: { questions: 0, blocks: 0, lawRoot: 0 },
};

// Call it from a `beforeEach`: a test sets the chain BEFORE it renders, so createTestConfig must not wipe it.
export function resetChain() {
  Object.assign(chainFixture, {
    blockTime: BLOCK_TIME,
    readsFail: false,
    blockFails: false,
    simulate: undefined,
    sendHash: `0x${'c1'.repeat(32)}` as Hex,
    sendError: undefined,
    lawRoot: `0x${'00'.repeat(32)}` as Hex,
    provider: fujiDeployment.provider,
    checker: fujiDeployment.checker,
    answerWindow: 600n,
    rolesFail: false,
  });
  chainFixture.questions = new Map();
  chainFixture.receipts = new Map();
  chainFixture.sent = [];
  chainFixture.reads = { questions: 0, blocks: 0, lawRoot: 0 };
}

const STATUS_INDEX = { None: 0, Open: 1, Paid: 2, Refunded: 3 } as const;
const BALANCE_OF = '0x70a08231';

// What a node answers over JSON-RPC, as viem would build it from an HTTP reply. Plain `Error`s are
// retried by viem with a back-off (about 1 s); an RpcRequestError with a code is not.
const rpcError = (code: number, message: string, data?: Hex) =>
  new RpcRequestError({
    body: {},
    url: 'http://fake-rpc',
    error: { code, message, ...(data !== undefined && { data }) },
  });

// One eth_call to the escrow, answered from the fixture.
function escrowCall(data: Hex): Hex {
  const { functionName, args } = decodeFunctionData({ abi: askPayEscrowAbi, data });
  switch (functionName) {
    case 'questions': {
      chainFixture.reads.questions += 1;
      if (chainFixture.readsFail) throw rpcError(-32000, 'RPC down');
      const q = chainFixture.questions.get(String(args?.[0]).toLowerCase());
      return encodeFunctionResult({
        abi: askPayEscrowAbi,
        functionName,
        result: [
          q?.payer ?? '0x0000000000000000000000000000000000000000',
          q?.amount ?? 0n,
          BigInt(q?.deadline ?? 0),
          STATUS_INDEX[q?.status ?? 'None'],
        ],
      });
    }
    case 'lawRoot':
      chainFixture.reads.lawRoot += 1;
      if (chainFixture.readsFail) throw rpcError(-32000, 'RPC down');
      return encodeFunctionResult({
        abi: askPayEscrowAbi,
        functionName,
        result: chainFixture.lawRoot,
      });
    case 'provider':
    case 'checker':
    case 'answerWindow': {
      if (chainFixture.rolesFail) throw rpcError(-32000, 'RPC down');
      const result =
        functionName === 'provider'
          ? chainFixture.provider
          : functionName === 'checker'
            ? chainFixture.checker
            : chainFixture.answerWindow;
      return encodeFunctionResult({
        abi: askPayEscrowAbi,
        functionName,
        result,
      } as Parameters<typeof encodeFunctionResult>[0]);
    }
    case 'claimRefund': {
      // A simulation is a direct eth_call with `from` (viem does not batch a call that has one).
      const qid = String(args?.[0]) as Hex;
      if (chainFixture.simulate === 'rpc') throw rpcError(-32000, 'RPC down');
      if (chainFixture.simulate === 'QuestionNotOpen') {
        throw rpcError(
          3,
          'execution reverted',
          encodeErrorResult({ abi: askPayEscrowAbi, errorName: 'QuestionNotOpen', args: [qid] }),
        );
      }
      if (chainFixture.simulate === 'DeadlineNotReached') {
        throw rpcError(
          3,
          'execution reverted',
          encodeErrorResult({
            abi: askPayEscrowAbi,
            errorName: 'DeadlineNotReached',
            args: [qid, BigInt(chainFixture.questions.get(qid.toLowerCase())?.deadline ?? 0)],
          }),
        );
      }
      return '0x';
    }
    default:
      throw new Error(`Unexpected escrow call in test: ${functionName}`);
  }
}

function blockOf(timestamp: number) {
  const zero = `0x${'00'.repeat(32)}`;
  return {
    number: '0x10',
    hash: `0x${'0b'.repeat(32)}`,
    parentHash: zero,
    nonce: '0x0000000000000000',
    sha3Uncles: zero,
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: zero,
    stateRoot: zero,
    receiptsRoot: zero,
    miner: '0x0000000000000000000000000000000000000000',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x100',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    timestamp: numberToHex(timestamp),
    transactions: [],
    uncles: [],
    mixHash: zero,
  };
}

function receiptOf(hash: string, fixture: ReceiptFixture) {
  return {
    transactionHash: hash,
    transactionIndex: '0x0',
    blockHash: `0x${'0b'.repeat(32)}`,
    blockNumber: '0x11',
    from: ACCOUNT_A_LOWER,
    to: fujiDeployment.address,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    contractAddress: null,
    logsBloom: `0x${'00'.repeat(256)}`,
    type: '0x2',
    status: fixture.status === 'success' ? '0x1' : '0x0',
    logs: fixture.logs.map((log, index) => ({
      ...log,
      blockNumber: '0x11',
      blockHash: `0x${'0b'.repeat(32)}`,
      transactionHash: hash,
      transactionIndex: '0x0',
      logIndex: numberToHex(index),
      removed: false,
    })),
  };
}
const ACCOUNT_A_LOWER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

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
  const answerCall = (data: Hex): Hex => {
    if (data.startsWith(BALANCE_OF)) {
      rpcStats.balanceReads += 1;
      if (balanceError) throw rpcError(-32000, 'RPC down');
      return balanceOf(data) as Hex;
    }
    return escrowCall(data);
  };
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const [first] = (params ?? []) as unknown[];
      switch (method) {
        case 'eth_call': {
          const { data } = must(first as { data: Hex });
          // wagmi batches reads through Multicall3 on chains that have it: an aggregate3 of calls,
          // each answered on its own (a failing read comes back as success: false).
          let calls: readonly { callData: Hex }[] | undefined;
          try {
            const decoded = decodeFunctionData({ abi: multicall3Abi, data });
            calls = decoded.args[0] as readonly { callData: Hex }[];
          } catch {
            calls = undefined;
          }
          if (calls === undefined) return answerCall(data);
          const result = calls.map((call) => {
            try {
              return { success: true, returnData: answerCall(call.callData) };
            } catch (error) {
              // A revert comes back as `success: false` with the revert data, as Multicall3 does.
              const data = (error as { data?: Hex; cause?: { data?: Hex } }).data;
              return { success: false, returnData: data ?? ('0x' as Hex) };
            }
          });
          return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result });
        }
        case 'eth_getBlockByNumber':
          chainFixture.reads.blocks += 1;
          if (chainFixture.blockFails) throw rpcError(-32000, 'RPC down');
          return blockOf(chainFixture.blockTime);
        case 'eth_getTransactionReceipt': {
          const hash = String(first);
          const fixture = chainFixture.receipts.get(hash);
          return fixture ? receiptOf(hash, fixture) : null;
        }
        default:
          throw new Error(`Unexpected RPC call in test: ${method}`);
      }
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
