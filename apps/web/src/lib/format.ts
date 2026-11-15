import { formatUsdc } from '@askpay/shared/money';
import { SNOWTRACE_BASE_URL } from './constants';

// "12.5" -> "12,5": Vietnamese decimal comma. Amounts stay bigint until this point.
export function formatUsdcVi(units: bigint): string {
  return formatUsdc(units).replace('.', ',');
}

// Fixed rate for the on-screen estimate only (design-system §4). Not a live exchange rate.
export const USDC_VND_ESTIMATE = 26_000n;

// 50000n (0.05 USDC) -> "1.300": whole đồng, rounded to the nearest 100, dot as thousands separator.
// bigint all the way; the result is a display string, never fed back into money logic.
export function formatVndEstimate(units: bigint): string {
  const dong = (units * USDC_VND_ESTIMATE) / 1_000_000n;
  const rounded = ((dong + 50n) / 100n) * 100n;
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// 0x869e95576f6dd6f06118cf733b4f307ae37ddce0 -> 0x869e…dce0
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function snowtraceAddressUrl(address: string): string {
  return `${SNOWTRACE_BASE_URL}/address/${address}`;
}
