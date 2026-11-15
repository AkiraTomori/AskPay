import { statsSchema, questionListItemSchema } from '@askpay/shared/api';
import { describe, expect, it } from 'vitest';
import {
  formatRunDate,
  toReasonRows,
  toRowView,
  toStatsView,
} from '@/features/dashboard/dashboard-view';
import { EVAL, rowBody, statsBody } from '../../helpers/dashboard-api';

const stats = (over: Record<string, unknown> = {}) => statsSchema.parse(statsBody(over));

describe('toStatsView: tiles (W4 §4)', () => {
  it('W4-E01 AP-08-AC01: the four tiles from the api.md fixture', () => {
    const { tiles } = toStatsView(stats());
    expect(tiles.questions).toMatchObject({ value: '42', sub: 'đã giữ tiền' });
    expect(tiles.paid.value).toBe('31');
    expect(tiles.refunded).toMatchObject({ value: '11', sub: '26,2% tỉ lệ hoàn tiền' });
    expect(tiles.revenue).toMatchObject({ value: '1,55', unit: 'USDC' });
    expect(tiles.revenue.sub).toMatch(/^≈ .+đ \(ước tính\)$/);
  });

  it('W4-E03: nothing settled yet says so instead of "0%"', () => {
    const view = toStatsView(
      stats({
        paid: 0,
        refunded: 0,
        refundRate: 0,
        refundsByReason: {
          NO_CITATION: 0,
          INVALID_CITATION: 0,
          CHECKER_REJECTED: 0,
          ANSWER_FAILED: 0,
          TIMEOUT: 0,
        },
      }),
    );
    expect(view.tiles.refunded.sub).toBe('chưa có câu đã chốt');
    expect(JSON.stringify(view.tiles)).not.toContain('0%');
    expect(view.reasons).toEqual([]);
  });

  it('keeps counts that are not settled out of the sub line: no extra number is invented', () => {
    const { tiles } = toStatsView(stats({ questions: 50 }));
    expect(tiles.paid.sub).toBeUndefined();
    expect(tiles.questions.value).toBe('50');
  });

  it('W4-E04: money stays a bigint: no rounding, and a uint256 does not throw', () => {
    expect(toStatsView(stats({ providerRevenue: '1550001' })).tiles.revenue.value).toBe('1,550001');
    const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    expect(() => toStatsView(stats({ providerRevenue: max }))).not.toThrow();
  });

  it('writes thousands with a dot, never "1,3K"', () => {
    expect(toStatsView(stats({ questions: 1284 })).tiles.questions.value).toBe('1.284');
  });
});

describe('toStatsView: provenance and eval', () => {
  it('W4-E02 AP-08-AC02: the block is written with dots; 0 means the indexer has not run', () => {
    expect(toStatsView(stats()).block).toBe('38.123.456');
    expect(toStatsView(stats({ lastIndexedBlock: 0 })).block).toBeUndefined();
  });

  it('W4-E06 AP-09-AC03: no eval -> null; an eval -> three percentages, a date and a commit link', () => {
    expect(toStatsView(stats()).eval).toBeNull();
    const view = toStatsView(stats({ eval: EVAL })).eval;
    expect(view?.metrics.map((metric) => metric.value)).toEqual(['82%', '78%', '90%']);
    expect(view?.runDate).toBe('18/11/2026');
    expect(view?.commitUrl).toBe('https://github.com/AkiraTomori/AskPay/commit/abc1234');
  });

  it('shows a run date that is not YYYY-MM-DD as written, and links only a hex commit', () => {
    expect(formatRunDate('hôm qua')).toBe('hôm qua');
    const view = toStatsView(
      stats({ eval: { ...EVAL, runAt: 'hôm qua', commit: 'x"><script>' } }),
    ).eval;
    expect(view?.runDate).toBe('hôm qua');
    expect(view?.commitUrl).toBeUndefined();
  });
});

describe('toReasonRows (W4 §5.2)', () => {
  const byReason = stats().refundsByReason;
  it('W4-E05: largest first, ties in the shared order; the largest bar is 100%; zero has no width', () => {
    const rows = toReasonRows(byReason);
    expect(rows.map((row) => [row.code, row.count])).toEqual([
      ['NO_CITATION', 6],
      ['CHECKER_REJECTED', 3],
      ['INVALID_CITATION', 1],
      ['TIMEOUT', 1],
      ['ANSWER_FAILED', 0],
    ]);
    expect(rows[0]?.widthPct).toBe(100);
    expect(rows[1]?.widthPct).toBe(50);
    expect(rows[4]?.widthPct).toBe(0);
  });

  it('keeps all five rows, in the shared order, when every count is equal', () => {
    const equal = {
      NO_CITATION: 2,
      INVALID_CITATION: 2,
      CHECKER_REJECTED: 2,
      ANSWER_FAILED: 2,
      TIMEOUT: 2,
    };
    expect(toReasonRows(equal).map((row) => row.code)).toEqual([
      'NO_CITATION',
      'INVALID_CITATION',
      'CHECKER_REJECTED',
      'ANSWER_FAILED',
      'TIMEOUT',
    ]);
  });
});

describe('toRowView (W4 §6)', () => {
  const row = (over: Record<string, unknown> = {}) =>
    toRowView(questionListItemSchema.parse(rowBody(1, over)));

  it('links to the question page and shows Vietnam time', () => {
    const view = row();
    expect(view.href).toMatch(/^\/questions\/0x[0-9a-f]{64}$/);
    expect(view.time).toBe('15/11 21:39');
  });

  it('W4-E08 AP-07-AC03: badges follow status + settle tx', () => {
    expect(row({ status: 'PAID', tx: {} }).badge).toBe('pending');
    expect(row({ status: 'CLAIMABLE', tx: {} }).badge).toBe('expired');
    expect(row({ status: 'REFUNDED', reason: 'TIMEOUT' }).badge).toBe('refunded');
    expect(row({ status: 'PENDING', tx: {} }).settleTx).toBeUndefined();
  });
});
