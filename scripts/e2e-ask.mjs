// End-to-end check of POST /api/ask with the REAL server (A5): real USDC authorisation, real escrow,
// real LLM, real Merkle proofs and verdict signatures. It starts apps/api/dist/server.js itself,
// plays the client, then reads the chain to see what really happened.
//
//   npm run e2e:ask -- --target fork            # anvil fork of Fuji: no cost, nothing real is touched
//   npm run e2e:ask -- --target fuji --send     # REAL Fuji: broadcasts transactions (owner approval)
//
// Four scenarios: PAID, NO_CITATION, INVALID_CITATION (the demo's fake citation) from tasks.csv A5,
// and LOST_DB: a deposit nobody knows about is refunded by a server that starts on an empty database
// (AP-05-AC08).
//
// fork: start `anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc` first. The script
//   impersonates the escrow owner to point provider and checker at throwaway keys, and writes a USDC
//   balance for a throwaway payer. Only the local anvil state changes.
// fuji: keys come from `.env.e2e` (PROVIDER_PRIVATE_KEY, CHECKER_PRIVATE_KEY, E2E_PAYER_PRIVATE_KEY);
//   the escrow checks that they are the deployed provider and checker. Costs the payer 0.05 USDC (the
//   PAID one, paid to the provider; the other three are refunded) and a little AVAX in gas.
// Both: the LLM key comes from `.env.poc` (GROQ_API_KEY). No key is ever printed.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseSignature,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { askPayEscrowAbi, fujiDeployment } from '../packages/shared/dist/abi/index.js';
import {
  ESCROW_SCHEME,
  FUJI_NETWORK,
  X402_VERSION,
  decodeHeader,
  encodeHeader,
  paymentRequiredSchema,
  paymentResponseSchema,
  receiveAuthorizationTypedData,
} from '../packages/shared/dist/x402.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0
    ? args[at + 1]?.startsWith('--') || args[at + 1] === undefined
      ? true
      : args[at + 1]
    : fallback;
};
const target = flag('target', 'fork');
const send = args.includes('--send');
if (target !== 'fork' && target !== 'fuji') fail('--target must be fork or fuji');
if (target === 'fuji' && !send) {
  fail('Fuji broadcasts real transactions. Re-run with --send once the owner has approved them.');
}

if (target === 'fuji') {
  console.log(`About to broadcast on Fuji (43113), escrow ${fujiDeployment.address}:
  provider wallet sends: 3 x deposit (one per question), 1 x deposit (the LOST_DB scenario),
                         3 x settle (PAID, NO_CITATION with an empty list, INVALID_CITATION),
                         1 x refundByProvider (from the second server)
  payer and checker only sign off-chain. Cost: 0.05 USDC to the provider (the PAID one) and gas.`);
}

const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const rpcUrl = target === 'fork' ? (process.env.FORK_RPC ?? 'http://127.0.0.1:8545') : FUJI_RPC;
const escrow = fujiDeployment.address;
const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
]);
const ownerAbi = parseAbi([
  'function owner() view returns (address)',
  'function setProvider(address)',
  'function setChecker(address)',
]);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
const key = (name) => {
  const raw = process.env[name]?.trim();
  if (!raw) fail(`${name} is not set`);
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
let providerKey;
let checkerKey;
let payerKey;

if (target === 'fork') {
  providerKey = generatePrivateKey();
  checkerKey = generatePrivateKey();
  payerKey = generatePrivateKey();
  await prepareFork();
} else {
  providerKey = key('PROVIDER_PRIVATE_KEY');
  checkerKey = key('CHECKER_PRIVATE_KEY');
  payerKey = key('E2E_PAYER_PRIVATE_KEY');
}
const payer = privateKeyToAccount(payerKey);
const token = await publicClient.readContract({
  address: escrow,
  abi: askPayEscrowAbi,
  functionName: 'token',
});
const [tokenName, tokenVersion] = await Promise.all([
  publicClient.readContract({ address: token, abi: erc20, functionName: 'name' }),
  publicClient.readContract({ address: token, abi: erc20, functionName: 'version' }),
]);
const balance = await publicClient.readContract({
  address: token,
  abi: erc20,
  functionName: 'balanceOf',
  args: [payer.address],
});
console.log(`target ${target}; payer ${payer.address}; USDC balance ${balance} units`);
if (balance < 200_000n) fail('the payer needs at least 4 x 0.05 USDC (200000 units)');

// --- fork preparation ------------------------------------------------------------------------

async function prepareFork() {
  const test = createTestClient({ chain: avalancheFuji, mode: 'anvil', transport: http(rpcUrl) });
  const owner = await publicClient.readContract({
    address: escrow,
    abi: ownerAbi,
    functionName: 'owner',
  });
  const provider = privateKeyToAccount(providerKey).address;
  const checker = privateKeyToAccount(checkerKey).address;
  const payerAddress = privateKeyToAccount(payerKey).address;

  await test.setBalance({ address: owner, value: 10n ** 18n });
  await test.setBalance({ address: provider, value: 10n * 10n ** 18n });
  await test.impersonateAccount({ address: owner });
  const asOwner = createWalletClient({
    chain: avalancheFuji,
    account: owner,
    transport: http(rpcUrl),
  });
  for (const [functionName, address] of [
    ['setProvider', provider],
    ['setChecker', checker],
  ]) {
    const hash = await asOwner.writeContract({
      address: escrow,
      abi: ownerAbi,
      functionName,
      args: [address],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  await test.stopImpersonatingAccount({ address: owner });

  // The payer's USDC balance: FiatToken keeps `balanceAndBlacklistStates` at storage slot 9.
  const usdc = await publicClient.readContract({
    address: escrow,
    abi: askPayEscrowAbi,
    functionName: 'token',
  });
  const slot = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [payerAddress, 9n]),
  );
  await test.setStorageAt({ address: usdc, index: slot, value: toHex(1_000_000n, { size: 32 }) });
  const now = await publicClient.readContract({
    address: usdc,
    abi: erc20,
    functionName: 'balanceOf',
    args: [payerAddress],
  });
  if (now !== 1_000_000n)
    fail('could not give the throwaway payer USDC on the fork (storage layout differs)');
}

// --- the server --------------------------------------------------------------------------------

const llmKey = process.env.GROQ_API_KEY?.trim();
if (!llmKey) fail('GROQ_API_KEY is not set (put it in .env.poc)');

// Starts apps/api/dist/server.js with its own empty database. Resolves once it is listening.
async function startServer() {
  const port = 4100 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['apps/api/dist/server.js'], {
    env: {
      PATH: process.env.PATH,
      RPC_URL: rpcUrl,
      CHAIN_ID: '43113',
      PROVIDER_PRIVATE_KEY: providerKey,
      CHECKER_PRIVATE_KEY: checkerKey,
      LLM_PROVIDER: 'groq',
      LLM_API_KEY: llmKey,
      LLM_MODEL: process.env.LLM_MODEL ?? 'qwen/qwen3.8-27b',
      DEMO_FAKE_CITATION: 'true',
      DATABASE_PATH: join(mkdtempSync(join(tmpdir(), 'askpay-e2e-')), 'askpay.sqlite'),
      PORT: String(port),
      LOG_LEVEL: 'info',
      // A fork's cold cache makes every log read slow and counts against the public RPC's limits.
      SCAN_LOOKBACK_BLOCKS: '1500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const handle = { port, log: '', stop: () => child.kill('SIGTERM') };
  child.stdout.on('data', (chunk) => (handle.log += chunk));
  child.stderr.on('data', (chunk) => (handle.log += chunk));
  process.on('exit', handle.stop);
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (handle.log.includes('askpay api listening')) {
        clearInterval(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited early:\n${handle.log.slice(-1500)}`));
      } else if (Date.now() - started > 120_000) {
        clearInterval(timer);
        reject(new Error(`server did not start in time:\n${handle.log.slice(-1500)}`));
      }
    }, 250);
  }).catch((error) => {
    console.error(error.message);
    handle.stop();
    process.exit(1);
  });
  // Let the startup scan for stray deposits finish before any request: on a cold fork both fight for
  // the same rate-limited upstream RPC, and a request can then fail for reasons that are not ours.
  await new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (handle.log.includes('deposit scan caught up') || Date.now() - started > 120_000) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });
  return handle;
}

let server = await startServer();
console.log(`server up on :${server.port}`);

// --- the client -----------------------------------------------------------------------------

const api = (body, headers = {}) =>
  fetch(`http://localhost:${server.port}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(async (response) => ({ response, json: await response.json() }));

async function askAndPay(question) {
  const first = await api({ question });
  if (first.response.status !== 402) throw new Error(`expected 402, got ${first.response.status}`);
  const quote = paymentRequiredSchema.parse(first.json);
  const requirement = quote.accepts[0];
  const authorization = {
    from: payer.address,
    to: requirement.payTo,
    value: BigInt(requirement.amount),
    validAfter: 0n,
    validBefore: BigInt(requirement.extra.validBefore),
    nonce: requirement.extra.qid,
  };
  const signature = await payer.signTypedData(
    receiveAuthorizationTypedData({
      tokenName,
      tokenVersion,
      asset: requirement.asset,
      authorization,
    }),
  );
  const header = encodeHeader({
    x402Version: X402_VERSION,
    accepted: {
      scheme: ESCROW_SCHEME,
      network: FUJI_NETWORK,
      asset: requirement.asset,
      amount: requirement.amount,
      payTo: requirement.payTo,
      extra: { qid: requirement.extra.qid },
    },
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: '0',
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  });
  const paid = await api({ question, qid: requirement.extra.qid }, { 'PAYMENT-SIGNATURE': header });
  return { qid: requirement.extra.qid, ...paid };
}

// What the chain says, independent of the server's answer.
async function chainSays(qid, settleTx) {
  const [, , , status] = await publicClient.readContract({
    address: escrow,
    abi: askPayEscrowAbi,
    functionName: 'questions',
    args: [qid],
  });
  const statusName = ['None', 'Open', 'Paid', 'Refunded'][status];
  if (!settleTx) return { status: statusName };
  const receipt = await publicClient.getTransactionReceipt({ hash: settleTx });
  const events = parseEventLogs({
    abi: askPayEscrowAbi,
    logs: receipt.logs,
    eventName: ['Paid', 'Refunded'],
  }).filter((log) => log.address.toLowerCase() === escrow.toLowerCase() && log.args.qid === qid);
  const reasons = [
    'None',
    'NO_CITATION',
    'INVALID_CITATION',
    'CHECKER_REJECTED',
    'ANSWER_FAILED',
    'TIMEOUT',
  ];
  const event = events[0];
  return {
    status: statusName,
    event: event?.eventName,
    reason: event?.eventName === 'Refunded' ? reasons[Number(event.args.reason)] : undefined,
  };
}

const SCENARIOS = [
  {
    name: 'PAID',
    question: 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?',
    expect: { stage: 'PAID', chain: 'Paid', event: 'Paid' },
  },
  {
    name: 'NO_CITATION',
    question: 'Cách nấu phở bò ngon tại nhà như thế nào?',
    expect: { stage: 'REFUNDED', reason: 'NO_CITATION', chain: 'Refunded', event: 'Refunded' },
  },
  {
    name: 'INVALID_CITATION',
    question: '#demo-fake Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?',
    expect: { stage: 'REFUNDED', reason: 'INVALID_CITATION', chain: 'Refunded', event: 'Refunded' },
  },
];

let failures = 0;
for (const scenario of SCENARIOS) {
  const started = Date.now();
  const { qid, response, json } = await askAndPay(scenario.question);
  const data = json.data;
  const settleTx = decodeHeader(
    paymentResponseSchema,
    response.headers.get('payment-response'),
  )?.settleTransaction;
  const chain = await chainSays(qid, settleTx).catch((error) => ({
    error: String(error).slice(0, 120),
  }));
  const want = scenario.expect;
  const ok =
    response.status === 200 &&
    data?.stage === want.stage &&
    (want.reason === undefined || data?.reason === want.reason) &&
    chain.status === want.chain &&
    chain.event === want.event &&
    (want.reason === undefined || chain.reason === want.reason);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${scenario.name}: HTTP ${response.status}, stage ${data?.stage}, reason ${data?.reason ?? '-'}, chain ${JSON.stringify(chain)}, ${Date.now() - started}ms`,
  );
  if (target === 'fuji' && settleTx)
    console.log(`     https://testnet.snowtrace.io/tx/${settleTx}`);
  if (!ok) {
    console.log('     body:', JSON.stringify(json).slice(0, 400));
    // The server's own account of it: warnings and errors for this question, no secrets in them.
    const lines = server.log
      .split('\n')
      .filter((line) => /"level":(40|50)/.test(line) && !line.includes('eth_getLogs'))
      .slice(-8);
    for (const line of lines) console.log('     server:', line.slice(0, 300));
  }
}

// --- scenario 4: a lost database (AP-05-AC08) -------------------------------------------------
// Money goes into escrow with no server and no row to know about it. A server that starts later, on
// an EMPTY database, must find the Deposited log and refund it by itself.
{
  const started = Date.now();
  server.stop(); // the first server is gone, as in a crash
  const providerAccount = privateKeyToAccount(providerKey);
  const lostQid = keccak256(toHex(`lost-database-${Date.now()}`));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await payer.signTypedData(
    receiveAuthorizationTypedData({
      tokenName,
      tokenVersion,
      asset: token,
      authorization: {
        from: payer.address,
        to: escrow,
        value: 50_000n,
        validAfter: 0n,
        validBefore,
        nonce: lostQid,
      },
    }),
  );
  const { r, s, v, yParity } = parseSignature(signature);
  const wallet = createWalletClient({
    chain: avalancheFuji,
    account: providerAccount,
    transport: http(rpcUrl),
  });
  const depositTx = await wallet.writeContract({
    address: escrow,
    abi: askPayEscrowAbi,
    functionName: 'deposit',
    args: [
      lostQid,
      payer.address,
      50_000n,
      0n,
      validBefore,
      Number(v ?? BigInt(27 + yParity)),
      r,
      s,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  const heldBefore = (await chainSays(lostQid)).status;

  server = await startServer(); // new process, brand new empty database
  let after = await chainSays(lostQid);
  for (let i = 0; i < 40 && after.status === 'Open'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    after = await chainSays(lostQid);
  }
  const ok = heldBefore === 'Open' && after.status === 'Refunded';
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} LOST_DB: before ${heldBefore}, after restart on an empty database ${after.status}, ${Date.now() - started}ms`,
  );
  if (!ok)
    for (const line of server.log
      .split('\n')
      .filter((l) => /"level":(40|50)/.test(l))
      .slice(-6))
      console.log('     server:', line.slice(0, 300));
}

server.stop();
console.log(failures === 0 ? '\nall scenarios PASS' : `\n${failures} scenario(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
