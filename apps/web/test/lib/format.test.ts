import { describe, expect, it } from 'vitest';
import {
  formatDateTimeFullVi,
  formatDateTimeVi,
  formatUsdcVi,
  formatVndEstimate,
  shortAddress,
  shortHash,
  snowtraceAddressUrl,
  snowtraceTxUrl,
} from '@/lib/format';

describe('formatUsdcVi', () => {
  it.each([
    [12_500_000n, '12,5'],
    [50_000n, '0,05'],
    [1_000_000n, '1'],
    [0n, '0'],
    [1n, '0,000001'],
  ])('formats %s base units as %s without rounding', (units, text) => {
    expect(formatUsdcVi(units)).toBe(text);
  });
});

describe('shortAddress', () => {
  it('keeps the head and the tail', () => {
    expect(shortAddress('0x869e95576f6dd6f06118cf733b4f307ae37ddce0')).toBe('0x869e…dce0');
  });
  it('leaves a value that is already short', () => {
    expect(shortAddress('0xabcd')).toBe('0xabcd');
  });
});

describe('snowtraceAddressUrl', () => {
  it('points at the Fuji testnet explorer', () => {
    expect(snowtraceAddressUrl('0xabc')).toBe('https://testnet.snowtrace.io/address/0xabc');
  });
});

describe('formatVndEstimate (design W2 §7)', () => {
  it('AP-02-AC03: 0.05 USDC is about 1.300đ', () => {
    expect(formatVndEstimate(50_000n)).toBe('1.300');
  });
  it('rounds to the nearest 100đ and groups thousands with dots', () => {
    expect(formatVndEstimate(1_000_000n)).toBe('26.000');
    expect(formatVndEstimate(10_000n)).toBe('300'); // 260đ → 300đ
    expect(formatVndEstimate(0n)).toBe('0');
  });
});

describe('transaction links and Vietnam time (design W3 §8)', () => {
  const hash = `0xda4c${'0'.repeat(54)}baf5`;

  it('shortHash keeps six characters and four at the end', () => {
    expect(shortHash(hash)).toBe('0xda4c…baf5');
  });

  it('snowtraceTxUrl points at the Fuji explorer', () => {
    expect(snowtraceTxUrl(hash)).toBe(`https://testnet.snowtrace.io/tx/${hash}`);
  });

  it('formatDateTimeVi is dd/MM HH:mm in Asia/Ho_Chi_Minh, whatever the machine zone', () => {
    // 14:40 UTC is 21:40 in Vietnam (UTC+7).
    expect(formatDateTimeVi(Date.UTC(2026, 10, 15, 14, 40))).toBe('15/11 21:40');
    // Crosses midnight: 18:05 UTC on the 15th is 01:05 on the 16th there.
    expect(formatDateTimeVi(Date.UTC(2026, 10, 15, 18, 5))).toBe('16/11 01:05');
    expect(formatDateTimeVi(Date.UTC(2026, 0, 2, 0, 0))).toBe('02/01 07:00');
  });

  it('formatDateTimeFullVi adds the year and seconds', () => {
    expect(formatDateTimeFullVi(Date.UTC(2026, 10, 15, 14, 40, 9))).toBe('15/11/2026 21:40:09');
  });
});
