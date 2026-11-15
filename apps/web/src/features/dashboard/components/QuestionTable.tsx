'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type MouseEvent } from 'react';
import { StatusBadge } from '@/components/question/StatusBadge';
import { TxLink } from '@/components/ui/TxLink';
import { toRowView, type RowView } from '../dashboard-view';
import { dashboardMessages as m } from '../messages';
import type { QuestionListItem } from '@askpay/shared/api';

// A real <table>. The whole row can be clicked with a mouse; for the keyboard each row has exactly
// two Tab stops, the question link and the tx link. The row is not wrapped in a link because the
// Snowtrace link lives inside it.
export function QuestionTable({
  items,
  focusQid,
}: {
  items: QuestionListItem[];
  // After "Xem thêm": move focus to the first new row's question link.
  focusQid: { seq: number; qid: string } | undefined;
}) {
  const router = useRouter();
  const body = useRef<HTMLTableSectionElement>(null);
  const seq = focusQid?.seq;
  const qid = focusQid?.qid;
  useEffect(() => {
    if (seq === undefined || qid === undefined) return;
    body.current?.querySelector<HTMLElement>(`a[data-qid="${qid}"]`)?.focus();
  }, [seq, qid]);

  const rows = items.map(toRowView);
  return (
    <table className="block w-full text-left text-sm sm:table">
      <caption className="sr-only">{m.recentTitle}</caption>
      <thead className="sr-only sm:not-sr-only sm:table-header-group">
        <tr className="border-b border-rule text-ink-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            {m.columns.time}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {m.columns.question}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {m.columns.status}
          </th>
          <th scope="col" className="py-2 font-medium">
            {m.columns.tx}
          </th>
        </tr>
      </thead>
      <tbody ref={body} className="block sm:table-row-group">
        {rows.map((row) => (
          <Row
            key={row.qid}
            row={row}
            onOpen={(event) => {
              // A click on a link (the question or the tx) is that link's own business.
              if ((event.target as HTMLElement).closest('a')) return;
              router.push(row.href);
            }}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row, onOpen }: { row: RowView; onOpen: (event: MouseEvent) => void }) {
  return (
    <tr
      onClick={onOpen}
      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-3 transition-colors duration-150 hover:bg-paper sm:table-row sm:py-0"
    >
      <td className="order-3 text-ink-muted sm:table-cell sm:py-3 sm:pr-3 sm:whitespace-nowrap">
        <time dateTime={row.dateTime} title={row.timeTitle}>
          {row.time}
        </time>
      </td>
      <td className="order-1 w-full sm:table-cell sm:w-auto sm:py-3 sm:pr-3">
        <Link
          href={row.href}
          data-qid={row.qid}
          title={row.question}
          className="line-clamp-2 underline-offset-2 hover:underline"
        >
          {row.question}
        </Link>
      </td>
      <td className="order-2 sm:table-cell sm:py-3 sm:pr-3 sm:whitespace-nowrap">
        <StatusBadge badge={row.badge} />
      </td>
      <td className="order-4 sm:table-cell sm:py-3 sm:whitespace-nowrap">
        {row.settleTx !== undefined ? (
          <TxLink hash={row.settleTx} />
        ) : (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">{m.noTx}</span>
          </>
        )}
      </td>
    </tr>
  );
}
