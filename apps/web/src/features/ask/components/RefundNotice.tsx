'use client';

import { REFUND_REASONS } from '@askpay/shared/errors';
import { ClockAlert, RotateCcw } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { getAddress } from 'viem';
import { formatCountdown, formatTimeOfDayVi, shortAddress } from '@/lib/format';
import { useCountdown } from '../hooks';
import { askMessages } from '../messages';
import type { NoticeView } from '../result-view';

export const NOTICE_ID = 'result-notice';

// The frame that says why the money came back (or that the question is overdue). It comes before
// the answer in the DOM, and a muted answer points at it with aria-describedby (W3 §4.1).
// The reason is said once for the whole question: the API does not say which card failed.
// `panel` is the claim panel (W5), drawn inside the frame of a claimable notice. `focusRef` lets the
// page move focus here when a claim succeeds.
export function RefundNotice({
  notice,
  panel,
  focusRef,
}: {
  notice: NoticeView;
  panel?: ReactNode;
  focusRef?: Ref<HTMLDivElement>;
}) {
  const claimable = notice.kind === 'claimable' || notice.kind === 'chainOpenNotYet';
  const Icon = claimable ? ClockAlert : RotateCcw;
  return (
    <div
      id={NOTICE_ID}
      ref={focusRef}
      tabIndex={-1}
      className={`flex items-start gap-3 rounded-md border p-4 ${claimable ? 'border-expired/40 bg-expired/12' : 'border-refund/40 bg-refund/12'}`}
    >
      <Icon
        aria-hidden
        className={`mt-0.5 size-5 shrink-0 ${claimable ? 'text-expired' : 'text-refund'}`}
      />
      <div className="flex min-w-0 flex-col gap-1">{lines(notice, panel)}</div>
    </div>
  );
}

function lines(notice: NoticeView, panel: ReactNode) {
  switch (notice.kind) {
    case 'noBasis':
      return (
        <>
          <p className="font-semibold">{askMessages.noBasisTitle}</p>
          <p>{REFUND_REASONS.NO_CITATION}</p>
          {notice.warnsAnswer && <p className="font-medium">{askMessages.failedCheckWarning}</p>}
        </>
      );
    case 'failedCheck':
      return (
        <>
          <p className="font-semibold">{askMessages.failedCheckWarning}</p>
          <p>{REFUND_REASONS[notice.reason]}</p>
        </>
      );
    case 'answerFailed':
      return <p>{askMessages.answerFailed}</p>;
    case 'timeout':
      return (
        <>
          <p>{askMessages.timeoutRefunded}</p>
          {notice.warnsAnswer && <p className="font-medium">{askMessages.uncheckedWarning}</p>}
        </>
      );
    case 'timeoutToPayer':
      return <p>{askMessages.timeoutRefundedToPayer(shortAddress(getAddress(notice.payer)))}</p>;
    case 'generic':
      return <p>{askMessages.refundedGeneric}</p>;
    case 'claimable':
      return (
        <>
          <p>{askMessages.statusClaimable}</p>
          {panel}
        </>
      );
    case 'chainOpenNotYet':
      return <OpenNotYet deadline={notice.deadline} />;
    case 'chainPaid':
      return <p>{askMessages.chainPaidNoContent}</p>;
    case 'chainRefunded':
      return <p>{askMessages.chainRefunded}</p>;
  }
}

// The deadline in Vietnam time, and a countdown that ticks every second WITHOUT a live region (a
// screen reader would be read to every second). The page announces once when the deadline is reached.
function OpenNotYet({ deadline }: { deadline: number }) {
  const left = useCountdown(deadline * 1000);
  return (
    <>
      <p>{askMessages.chainOpenNotYet(formatTimeOfDayVi(deadline * 1000))}</p>
      {left !== undefined && (
        <p className="font-mono">{askMessages.chainCountdown(formatCountdown(left))}</p>
      )}
    </>
  );
}
