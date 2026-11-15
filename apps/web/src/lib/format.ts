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

// 0xda4c…(64 hex)…baf5 -> 0xda4c…baf5
export function shortHash(hash: string): string {
  return shortAddress(hash);
}

export function snowtraceTxUrl(hash: string): string {
  return `${SNOWTRACE_BASE_URL}/tx/${hash}`;
}

// 1284 -> "1.284". Whole numbers are never shortened ("1,3K"): on Fuji they are small and a viewer
// compares them with Snowtrace.
export function formatIntegerVi(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// 0.262 -> "26,2%", 0.82 -> "82%": one decimal at most, and a ",0" is dropped. A ratio for reading,
// not money, so a `number` is fine here.
export function formatPercentVi(ratio: number): string {
  const tenths = Math.round(ratio * 1000) / 10;
  return `${tenths.toString().replace('.', ',')}%`;
}

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function vnParts(ms: number, withYear: boolean): Record<string, string> {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    ...(withYear && { year: 'numeric', second: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// 1762699400000 (ms since epoch) -> "09/11 21:40", always in Vietnam time. Built from parts because
// the vi-VN pattern puts the time first.
export function formatDateTimeVi(ms: number): string {
  const p = vnParts(ms, false);
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

// The same instant with the year and seconds, for a `title`.
export function formatDateTimeFullVi(ms: number): string {
  const p = vnParts(ms, true);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
