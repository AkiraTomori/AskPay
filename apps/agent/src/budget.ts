// The spending cap of one agent run (AP-10-AC02). Pure: money is bigint in the token's smallest
// unit and never passes through a float.
import { USDC_DECIMALS } from '@askpay/shared/money';

// "0.20", "5", "0.000001": digits, optionally a dot and 1 to 6 digits. No sign, no exponent, no
// bare ".5" (a typo costs nothing here, a misread cap costs money).
const BUDGET_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;

// Returns the cap in USDC units, or throws a RangeError with a message fit for the terminal.
export function parseBudget(text: string | undefined): bigint {
  const value = text?.trim() ?? '';
  const match = BUDGET_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(
      `--budget must be a USDC amount with up to ${USDC_DECIMALS} decimals, for example 0.20`,
    );
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(USDC_DECIMALS, '0');
  const units = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction);
  if (units <= 0n) throw new RangeError('--budget must be greater than 0');
  return units;
}

export interface Budget {
  readonly cap: bigint;
  // True and the amount is now committed, or false and nothing changed. Reaching the cap exactly
  // is allowed; exceeding it is not.
  reserve(amount: bigint): boolean;
  // Gives back a reservation, only when the server said no money moved.
  release(amount: bigint): void;
  committed(): bigint;
  remaining(): bigint;
}

export function createBudget(cap: bigint): Budget {
  if (cap < 0n) throw new RangeError('Budget cannot be negative');
  let committed = 0n;
  return {
    cap,
    reserve(amount) {
      if (amount < 0n || committed + amount > cap) return false;
      committed += amount;
      return true;
    },
    release(amount) {
      committed = committed > amount ? committed - amount : 0n;
    },
    committed: () => committed,
    remaining: () => cap - committed,
  };
}
