// Token amounts are bigint in the token's smallest unit (USDC has 6 decimals). On the wire they
// are integer strings, so a float never touches money.

export const USDC_DECIMALS = 6;

// Single definition of the wire format for amounts; api.ts reuses it.
export const UNITS_PATTERN = /^(0|[1-9][0-9]*)$/;

// Token amounts are uint256 on-chain, so anything larger can never be valid.
export const MAX_UINT256 = 2n ** 256n - 1n;

export function parseUnits(value: string): bigint {
  if (!UNITS_PATTERN.test(value)) {
    throw new RangeError(`Invalid token amount: expected a non-negative integer string`);
  }
  const units = BigInt(value);
  if (units > MAX_UINT256) throw new RangeError('Token amount exceeds uint256');
  return units;
}

export function unitsToString(units: bigint): string {
  if (units < 0n) throw new RangeError('Token amount cannot be negative');
  if (units > MAX_UINT256) throw new RangeError('Token amount exceeds uint256');
  return units.toString();
}

// Plain decimal with "." and no trailing zeros beyond what is needed (50000n -> "0.05").
// The web layer localises the separator; this stays locale-free so tests are stable.
export function formatUsdc(units: bigint): string {
  if (units < 0n) throw new RangeError('Token amount cannot be negative');
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}
