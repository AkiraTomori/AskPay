// The only place that reads the environment (backend.md §1). Everything else gets a Config.
import { z } from 'zod';
import { FUJI_CHAIN_ID } from '@askpay/shared/x402';

// Fixed on purpose, not env (system-design §5.6 B): they are behaviour in acceptance criteria, so a
// deploy environment must not be able to drift from the spec. Change them in code, with a test.
export const SETTLE_CUTOFF_SECONDS = 60;
export const PIPELINE_BUDGET_SECONDS = 120;
// A deposit mined after the authorisation expired would revert, so refuse chances that thin.
export const MIN_VALID_BEFORE_SECONDS = 60;
export const FAUCET_URL = 'https://faucet.circle.com';

const privateKey = z
  .string()
  .transform((value) => (value.startsWith('0x') ? value : `0x${value}`))
  .pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex private key'));

const envSchema = z.object({
  // Mainnet is out of scope for the MVP: any other chain id stops the process at startup.
  CHAIN_ID: z.coerce.number().pipe(z.literal(FUJI_CHAIN_ID)).default(FUJI_CHAIN_ID),
  RPC_URL: z.url(),
  PROVIDER_PRIVATE_KEY: privateKey,
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
});

export interface Config {
  rpcUrl: string;
  providerPrivateKey: `0x${string}`;
  priceUnits: bigint;
  quoteTtlSeconds: number;
  databasePath: string;
  port: number;
  rateLimitPerMinute: number;
}

// Never log the returned object: it holds the provider key.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Name the bad variables only; never echo values (they may be keys).
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid configuration: ${names.join(', ')}`);
  }
  const value = parsed.data;
  return {
    rpcUrl: value.RPC_URL,
    providerPrivateKey: value.PROVIDER_PRIVATE_KEY as `0x${string}`,
    priceUnits: value.PRICE_UNITS,
    quoteTtlSeconds: value.QUOTE_TTL_SECONDS,
    databasePath: value.DATABASE_PATH,
    port: value.PORT,
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
  };
}
