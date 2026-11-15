import { formatUsdc } from '@askpay/shared/money';
import { SNOWTRACE_BASE_URL } from './constants';

// "12.5" -> "12,5": Vietnamese decimal comma. Amounts stay bigint until this point.
export function formatUsdcVi(units: bigint): string {
  return formatUsdc(units).replace('.', ',');
}

// 0x869e95576f6dd6f06118cf733b4f307ae37ddce0 -> 0x869e…dce0
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function snowtraceAddressUrl(address: string): string {
  return `${SNOWTRACE_BASE_URL}/address/${address}`;
}
