import type { QuestionListItem, Stats } from '@askpay/shared/api';
import { refundReasonCodes, REFUND_REASONS, type RefundReasonCode } from '@askpay/shared/errors';
import { badgeOf, type Badge } from '@/components/question/status';
import { REPO_URL } from '@/lib/constants';
import {
  formatDateTimeFullVi,
  formatDateTimeVi,
  formatIntegerVi,
  formatPercentVi,
  formatUsdcVi,
  formatVndEstimate,
} from '@/lib/format';
import { dashboardMessages as m } from './messages';

// Pure view-models for /dashboard (design W4 §4–§6). Components only draw them.

// `unit` is drawn smaller next to the value ("1,55" + "USDC"), so a long amount still fits a tile.
export type Tile = { label: string; value: string; unit?: string; sub?: string };

export type ReasonRow = {
  code: RefundReasonCode;
  label: string;
  // The full sentence of REFUND_REASONS, for the `title`.
  sentence: string;
  count: number;
  // 0–100, relative to the largest row (not to the total), so the largest bar always fills.
  widthPct: number;
};

export type EvalView = {
  metrics: { key: string; label: string; value: string }[];
  runDate: string;
  commit: string;
  commitUrl: string | undefined;
};

export type StatsView = {
  tiles: { questions: Tile; paid: Tile; refunded: Tile; revenue: Tile };
  // Undefined while the indexer has not read a block yet.
  block: string | undefined;
  reasons: ReasonRow[];
  eval: EvalView | null;
};

// Largest first; equal counts keep the fixed order of REFUND_REASONS (Array.sort is stable).
export function toReasonRows(byReason: Stats['refundsByReason']): ReasonRow[] {
  const rows = refundReasonCodes.map((code) => ({
    code,
    label: m.reasonLabel[code],
    sentence: REFUND_REASONS[code],
    count: byReason[code] ?? 0,
  }));
  const max = Math.max(0, ...rows.map((row) => row.count));
  return rows
    .map((row) => ({ ...row, widthPct: max === 0 ? 0 : (row.count / max) * 100 }))
    .sort((a, b) => b.count - a.count);
}

// "2026-11-18" -> "18/11/2026"; anything else is shown as written.
export function formatRunDate(runAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runAt);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : runAt;
}

function toEvalView(summary: NonNullable<Stats['eval']>): EvalView {
  const { citationAccuracy, checkerPassRate, outOfScopeCorrect } = m.evalMetrics;
  return {
    metrics: [
      {
        key: 'citationAccuracy',
        label: citationAccuracy,
        value: formatPercentVi(summary.citationAccuracy),
      },
      {
        key: 'checkerPassRate',
        label: checkerPassRate,
        value: formatPercentVi(summary.checkerPassRate),
      },
      {
        key: 'outOfScopeCorrect',
        label: outOfScopeCorrect,
        value: formatPercentVi(summary.outOfScopeCorrect),
      },
    ],
    runDate: formatRunDate(summary.runAt),
    commit: summary.commit.slice(0, 7),
    // The commit comes from a file; only a hex string may become part of a URL.
    commitUrl: /^[0-9a-f]{7,40}$/i.test(summary.commit)
      ? `${REPO_URL}/commit/${summary.commit}`
      : undefined,
  };
}

export function toStatsView(stats: Stats): StatsView {
  const settled = stats.paid + stats.refunded;
  const revenue = BigInt(stats.providerRevenue);
  return {
    tiles: {
      questions: {
        label: m.tiles.questions,
        value: formatIntegerVi(stats.questions),
        sub: m.questionsSub,
      },
      paid: { label: m.tiles.paid, value: formatIntegerVi(stats.paid) },
      refunded: {
        label: m.tiles.refunded,
        value: formatIntegerVi(stats.refunded),
        // "0%" would read as "never refunds"; with nothing settled the rate means nothing.
        sub: settled === 0 ? m.noSettledYet : m.refundRateSub(formatPercentVi(stats.refundRate)),
      },
      revenue: {
        label: m.tiles.revenue,
        value: formatUsdcVi(revenue),
        unit: 'USDC',
        sub: m.vndEstimate(formatVndEstimate(revenue)),
      },
    },
    block: stats.lastIndexedBlock === 0 ? undefined : formatIntegerVi(stats.lastIndexedBlock),
    reasons: stats.refunded === 0 ? [] : toReasonRows(stats.refundsByReason),
    eval: stats.eval === null ? null : toEvalView(stats.eval),
  };
}

export type RowView = {
  qid: string;
  question: string;
  href: string;
  time: string;
  timeTitle: string;
  dateTime: string;
  badge: Badge;
  settleTx: string | undefined;
};

export function toRowView(item: QuestionListItem): RowView {
  const settleTx = item.tx.settle;
  return {
    qid: item.qid,
    question: item.question,
    href: `/questions/${item.qid}`,
    time: formatDateTimeVi(item.createdAt),
    timeTitle: formatDateTimeFullVi(item.createdAt),
    dateTime: new Date(item.createdAt).toISOString(),
    // Same rule as the result page: closed AND settle tx, else pending (AP-07-AC03).
    badge: badgeOf({ status: item.status, settleTx }),
    settleTx,
  };
}
