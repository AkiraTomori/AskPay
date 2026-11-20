// The only place that reads the environment (backend.md §1). Everything else gets a Config.
import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';
import { FUJI_CHAIN_ID } from '@askpay/shared/x402';
import type { LlmConfig } from './llm.js';

// Fixed on purpose, not env (system-design §5.6 B): they are behaviour in acceptance criteria, so a
// deploy environment must not be able to drift from the spec. Change them in code, with a test.
export const SETTLE_CUTOFF_SECONDS = 60;
// What the pipeline needs before settle: an LLM call twice, the checker, one replacement tx. A
// deposit that lands with less than cutoff + this left is refunded instead of answered (§5.6 A).
export const PIPELINE_BUDGET_SECONDS = 120;
// A deposit mined after the authorisation expired would revert, so refuse chances that thin.
export const MIN_VALID_BEFORE_SECONDS = 60;
export const FAUCET_URL = 'https://faucet.circle.com';
// One LLM call may take at most this long; a failed call gets one retry (system-design §5.3, §5.6 B).
export const LLM_CALL_TIMEOUT_MS = 20_000;
// POST /ask holds the request this long, then answers 202 and the client polls (T-07).
export const REQUEST_WAIT_MS = 60_000;
// How often unresolved questions are reconciled with the chain while the server runs (§5.6 D, F).
export const SWEEP_INTERVAL_MS = 15_000;
// How long /health, /stats and the first page of /questions are reused (shared/ttl-cache.ts). Fixed,
// not env: it is what keeps a burst of page views from becoming a burst of RPC calls.
export const READ_CACHE_TTL_MS = 5_000;

const privateKey = z
  .string()
  .transform((value) => (value.startsWith('0x') ? value : `0x${value}`))
  .pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex private key'));

const envSchema = z.object({
  // Mainnet is out of scope for the MVP: any other chain id stops the process at startup.
  CHAIN_ID: z.coerce.number().pipe(z.literal(FUJI_CHAIN_ID)).default(FUJI_CHAIN_ID),
  RPC_URL: z.url(),
  PROVIDER_PRIVATE_KEY: privateKey,
  // Signs verdicts only (T-04). Required: a server that takes money must be able to settle it.
  CHECKER_PRIVATE_KEY: privateKey,
  PRICE_UNITS: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .default('50000')
    .transform((value) => BigInt(value)),
  QUOTE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(MIN_VALID_BEFORE_SECONDS + 1)
    .default(300),
  DATABASE_PATH: z.string().min(1).default('./data/askpay.sqlite'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  // The read endpoints (GET /questions, /stats, /corpus, /health). A page polling one question every
  // second is 60 a minute, so the default leaves room for that and for a dashboard on the same IP.
  READ_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  // How many reverse proxies sit in front of the server (Render and Railway: 1). Without it every
  // caller shares the proxy's IP, so one limit would count the whole world as one visitor.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Required: without an LLM every question would be refunded after the payer already paid.
  LLM_PROVIDER: z.enum(['openrouter', 'groq']).default('openrouter'),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_JSON_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // Demo only (system-design §5.5): honoured for a question that starts with "#demo-fake".
  DEMO_FAKE_CITATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Demo only (system-design §5.5): honoured for a question that starts with "#demo-stall".
  DEMO_STALL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CORPUS_PATH: z.string().min(1).optional(),
  // How many blocks one eth_getLogs may span on this RPC. The public Fuji RPC allows 100.
  LOG_RANGE_BLOCKS: z.coerce.number().int().min(1).max(10_000).default(100),
  // With no checkpoint (a new or lost database), how many blocks back to look for stray deposits.
  SCAN_LOOKBACK_BLOCKS: z.coerce.number().int().min(1).default(43_200),
});

export interface Config {
  rpcUrl: string;
  providerPrivateKey: `0x${string}`;
  checkerPrivateKey: `0x${string}`;
  priceUnits: bigint;
  quoteTtlSeconds: number;
  databasePath: string;
  port: number;
  rateLimitPerMinute: number;
  readRateLimitPerMinute: number;
  trustProxyHops: number;
  llm: LlmConfig;
  demoFakeCitation: boolean;
  demoStall: boolean;
  corpusPath: string | undefined;
  logRangeBlocks: number;
  scanLookbackBlocks: number;
}

// Never log the returned object: it holds the provider and checker keys.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Name the bad variables only; never echo values (they may be keys).
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid configuration: ${names.join(', ')}`);
  }
  const value = parsed.data;
  // T-04: one key for both roles would let the wallet that receives the money approve its own
  // answers. Compare addresses, and name the variable only, never a value.
  if (
    privateKeyToAccount(value.CHECKER_PRIVATE_KEY as `0x${string}`).address ===
    privateKeyToAccount(value.PROVIDER_PRIVATE_KEY as `0x${string}`).address
  ) {
    throw new Error(
      'Invalid configuration: CHECKER_PRIVATE_KEY (must differ from the provider key)',
    );
  }
  return {
    rpcUrl: value.RPC_URL,
    providerPrivateKey: value.PROVIDER_PRIVATE_KEY as `0x${string}`,
    checkerPrivateKey: value.CHECKER_PRIVATE_KEY as `0x${string}`,
    priceUnits: value.PRICE_UNITS,
    quoteTtlSeconds: value.QUOTE_TTL_SECONDS,
    databasePath: value.DATABASE_PATH,
    port: value.PORT,
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    readRateLimitPerMinute: value.READ_RATE_LIMIT_PER_MINUTE,
    trustProxyHops: value.TRUST_PROXY_HOPS,
    llm: {
      provider: value.LLM_PROVIDER,
      apiKey: value.LLM_API_KEY,
      model: value.LLM_MODEL,
      jsonMode: value.LLM_JSON_MODE,
    },
    demoFakeCitation: value.DEMO_FAKE_CITATION,
    demoStall: value.DEMO_STALL,
    corpusPath: value.CORPUS_PATH,
    logRangeBlocks: value.LOG_RANGE_BLOCKS,
    scanLookbackBlocks: value.SCAN_LOOKBACK_BLOCKS,
  };
}
