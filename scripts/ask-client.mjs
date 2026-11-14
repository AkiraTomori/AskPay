// A minimal x402 client for POST /api/ask: ask, receive the 402 quote, sign the EIP-3009
// authorisation as the payer, pay. It is what the web wallet will do, in script form (A4).
//
//   npm run ask:client -- "Thời gian thử việc tối đa là bao lâu?"
//
// The payer key comes only from `.env.e2e` (E2E_PAYER_PRIVATE_KEY) and is never printed.
// Optional: API_URL (default http://localhost:4000).
import { privateKeyToAccount } from 'viem/accounts';
import {
  decodeHeader,
  paymentRequiredSchema,
  paymentResponseSchema,
  receiveAuthorizationTypedData,
  encodeHeader,
  X402_VERSION,
  ESCROW_SCHEME,
  FUJI_NETWORK,
} from '@askpay/shared/x402';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
const question = process.argv[2];
if (!question) {
  console.error('usage: npm run ask:client -- "<question>"');
  process.exit(1);
}

const raw = process.env.E2E_PAYER_PRIVATE_KEY?.trim();
if (!raw) {
  console.error('ERROR: E2E_PAYER_PRIVATE_KEY is not set (put it in .env.e2e)');
  process.exit(1);
}
const payer = privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`);

async function post(body, headers = {}) {
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

// 1. Ask. Expect a 402 quote.
const first = await post({ question });
if (first.response.status !== 402) {
  console.error(`expected 402, got ${first.response.status}`, first.json);
  process.exit(1);
}
const quote = paymentRequiredSchema.parse(first.json);
const requirement = quote.accepts[0];
console.log(`quote: ${requirement.amount} units, qid ${requirement.extra.qid}`);
console.log(`payer: ${payer.address}`);

// 2. Sign what the quote asked for.
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
    tokenName: requirement.extra.tokenName,
    tokenVersion: requirement.extra.tokenVersion,
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
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
      nonce: authorization.nonce,
    },
  },
});

// 3. Pay.
const second = await post(
  { question, qid: requirement.extra.qid },
  { 'PAYMENT-SIGNATURE': header },
);
console.log(`pay: HTTP ${second.response.status}`, JSON.stringify(second.json));
const receipt = decodeHeader(
  paymentResponseSchema,
  second.response.headers.get('payment-response') ?? undefined,
);
if (receipt?.transaction)
  console.log(`deposit tx: https://testnet.snowscan.xyz/tx/${receipt.transaction}`);
