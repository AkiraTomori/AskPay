// The only file that talks to AskPayEscrow and the token for payments (backend.md §2). It decides
// nothing: payment.service and ask.service use what it reads.
import { parseAbi, parseSignature, type Address, type Hex } from 'viem';
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import type { ChainClients } from '../../shared/chain.js';
import type { TxOutcome, TxQueue } from '../../shared/tx-queue.js';

export type OnChainStatus = 'None' | 'Open' | 'Paid' | 'Refunded';
const STATUSES: readonly OnChainStatus[] = ['None', 'Open', 'Paid', 'Refunded'];

// Gas the provider wallet must be able to pay for one question: a deposit now and a settle later.
// Generous on purpose; Fuji fees are tiny, and refusing early costs nothing (AP-03-AC07).
const GAS_BUDGET_PER_QUESTION = 700_000n;
const FEE_SAFETY_FACTOR = 2n;

const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);

export interface DepositRequest {
  qid: Hex;
  payer: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  signature: Hex;
}

export interface PaymentChain {
  readonly escrow: Address;
  readonly token: Address;
  readonly tokenName: string;
  readonly tokenVersion: string;
  readonly answerWindowSeconds: number;
  payerBalance(payer: Address): Promise<bigint>;
  providerCanPayGas(): Promise<boolean>;
  questionStatus(qid: Hex): Promise<OnChainStatus>;
  deposit(request: DepositRequest): Promise<TxOutcome>;
}

// Reads the token domain and the escrow settings once, and refuses to start if this process holds
// the wrong key: deposit reverts with NotProvider otherwise, only after a payer has signed.
export async function createPaymentChain(
  clients: ChainClients,
  txQueue: TxQueue,
): Promise<PaymentChain> {
  const { publicClient, account } = clients;
  const escrow = fujiDeployment.address as Address;
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({
      address: escrow,
      abi: askPayEscrowAbi,
      functionName,
      args,
    } as never) as Promise<T>;

  const [token, provider, answerWindow] = await Promise.all([
    read<Address>('token'),
    read<Address>('provider'),
    read<bigint>('answerWindow'),
  ]);
  if (provider.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('PROVIDER_PRIVATE_KEY does not belong to the escrow provider');
  }
  const [tokenName, tokenVersion] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'version' }),
  ]);

  return {
    escrow,
    token,
    tokenName,
    tokenVersion,
    answerWindowSeconds: Number(answerWindow),

    payerBalance: (payer) =>
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [payer],
      }),

    async providerCanPayGas() {
      const [balance, fees] = await Promise.all([
        publicClient.getBalance({ address: account.address }),
        publicClient.estimateFeesPerGas(),
      ]);
      const feePerGas = fees.maxFeePerGas ?? (await publicClient.getGasPrice());
      return balance >= feePerGas * GAS_BUDGET_PER_QUESTION * FEE_SAFETY_FACTOR;
    },

    async questionStatus(qid) {
      const [, , , status] = await read<readonly [Address, bigint, bigint, number]>('questions', [
        qid,
      ]);
      const name = STATUSES[status];
      if (!name) throw new Error(`unknown question status ${status}`);
      return name;
    },

    deposit(request) {
      const { v, r, s, yParity } = parseSignature(request.signature);
      return txQueue.send({
        abi: askPayEscrowAbi,
        address: escrow,
        functionName: 'deposit',
        args: [
          request.qid,
          request.payer,
          request.value,
          request.validAfter,
          request.validBefore,
          Number(v ?? BigInt(27 + yParity)),
          r,
          s,
        ],
      });
    },
  };
}
