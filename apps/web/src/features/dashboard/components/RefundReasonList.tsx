import type { ReasonRow } from '../dashboard-view';
import { dashboardMessages as m } from '../messages';

// A meter list: name, bar, number. One hue, largest first. Every number is printed, so there is no
// tooltip and the list itself is the "table view" of the bars (design W4 §5.2).
export function RefundReasonList({ reasons }: { reasons: ReasonRow[] }) {
  if (reasons.length === 0) return <p className="text-ink-muted">{m.noRefunds}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {reasons.map((row) => (
        <li
          key={row.code}
          title={row.sentence}
          className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 text-sm sm:grid-cols-[minmax(0,13rem)_1fr_auto]"
        >
          <span>
            {row.label}
            <span className="sr-only">{': '}</span>
          </span>
          <span aria-hidden className="h-2 rounded-r-[4px] bg-refund/12">
            {row.count > 0 && (
              <span
                className="block h-2 rounded-r-[4px] bg-refund"
                style={{ width: `${row.widthPct}%` }}
              />
            )}
          </span>
          <span className="min-w-6 text-right font-medium tabular-nums">
            {row.count}
            <span className="sr-only">{m.reasonUnit}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
