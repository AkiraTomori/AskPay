// POC-1: does Circle's USDC on Fuji accept a viem-signed ReceiveWithAuthorization when the
// caller is the token's `to` (AskPayEscrow.deposit)? Runs ONLY against a local anvil fork of
// Fuji. Never point RPC at a real network: it impersonates a holder and signs with a throwaway key.
//
//   anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc --port 8545
//   (deploy AskPayEscrow on the fork with script/Deploy.s.sol, then)
//   RPC=http://127.0.0.1:8545 ESCROW=0x… HOLDER=0x… node poc/poc-1/run.mjs
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  hashDomain,
  parseSignature,
  parseAbi,
  parseEventLogs,
  keccak256,
  toHex,
  defineChain,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const { RPC, ESCROW, HOLDER } = process.env;
if (!RPC?.startsWith('http://127.0.0.1') && !RPC?.startsWith('http://localhost')) {
  throw new Error('RPC must be a local anvil fork');
}
const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const PROVIDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // anvil account 1 (public)
const chain = defineChain({
  id: 43113,
  name: 'fuji-fork',
  nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
const abi = JSON.parse(
  readFileSync('contracts/out/AskPayEscrow.sol/AskPayEscrow.json', 'utf8'),
).abi;
const erc20 = parseAbi([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
]);
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${detail}`);
  if (!ok) process.exitCode = 1;
};

const name = await pub.readContract({ address: USDC, abi: erc20, functionName: 'name' });
const version = await pub.readContract({ address: USDC, abi: erc20, functionName: 'version' });
const onchainSep = await pub.readContract({
  address: USDC,
  abi: erc20,
  functionName: 'DOMAIN_SEPARATOR',
});
const domain = { name, version, chainId: 43113, verifyingContract: USDC };
check(
  'local domain separator == token DOMAIN_SEPARATOR',
  hashDomain({
    domain,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  }) === onchainSep,
  `(${name} v${version})`,
);

// Fund a fresh payer from a real holder (impersonated; no storage tampering).
const payer = privateKeyToAccount(generatePrivateKey());
const amount = 50_000n; // 0.05 USDC, price from Q-02
await test.setBalance({ address: HOLDER, value: 10n ** 18n });
await test.impersonateAccount({ address: HOLDER });
const holderWallet = createWalletClient({ chain, account: HOLDER, transport: http(RPC) });
await pub.waitForTransactionReceipt({
  hash: await holderWallet.writeContract({
    address: USDC,
    abi: erc20,
    functionName: 'transfer',
    args: [payer.address, amount * 2n],
  }),
});
const bal = (a) =>
  pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a] });
check('payer funded', (await bal(payer.address)) === amount * 2n);

const types = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
const runId = generatePrivateKey(); // unique qids per run: reruns on one fork must not hit QuestionExists
const now = (await pub.getBlock()).timestamp;
async function deposit(qid, domainOverride) {
  const message = {
    from: payer.address,
    to: ESCROW,
    value: amount,
    validAfter: 0n,
    validBefore: now + 3600n,
    nonce: qid,
  };
  const sig = await payer.signTypedData({
    domain: domainOverride ?? domain,
    types,
    primaryType: 'ReceiveWithAuthorization',
    message,
  });
  const { v, r, s } = parseSignature(sig);
  const provider = createWalletClient({ chain, account: PROVIDER, transport: http(RPC) });
  return provider.writeContract({
    address: ESCROW,
    abi,
    functionName: 'deposit',
    args: [qid, payer.address, amount, 0n, message.validBefore, Number(v), r, s],
  });
}

// Control: a signature with the wrong domain version must be rejected, so the PASS below means something.
await test.impersonateAccount({ address: PROVIDER });
// Rejected means it throws at gas estimation OR mines as a reverted tx; either way no money moves.
let rejected = false;
const poolBefore = await bal(ESCROW);
try {
  const r = await pub.waitForTransactionReceipt({
    hash: await deposit(keccak256(toHex(`poc1-bad-${runId}`)), { ...domain, version: '1' }),
  });
  rejected = r.status === 'reverted';
  console.log(`      control receipt status: ${r.status}`);
} catch (e) {
  rejected = true;
  console.log(`      control threw: ${String(e.shortMessage ?? e.message).slice(0, 120)}`);
}
check(
  'control: wrong-domain signature is rejected',
  rejected && (await bal(ESCROW)) === poolBefore,
);

const qid = keccak256(toHex(`poc1-good-${runId}`));
const before = await bal(ESCROW);
const receipt = await pub.waitForTransactionReceipt({ hash: await deposit(qid) });
const deposited = parseEventLogs({ abi, logs: receipt.logs, eventName: 'Deposited' });
check(
  'deposit tx succeeded',
  receipt.status === 'success',
  `(tx ${receipt.transactionHash}, gas ${receipt.gasUsed})`,
);
check('Deposited event emitted for qid', deposited.length === 1 && deposited[0].args.qid === qid);
check('escrow balance += amount', (await bal(ESCROW)) - before === amount);
check('payer balance -= amount', (await bal(payer.address)) === amount);
