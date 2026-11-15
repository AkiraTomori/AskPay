import { REFUND_REASONS } from '@askpay/shared/errors';
import { ClockAlert, RotateCcw } from 'lucide-react';
import { askMessages } from '../messages';
import type { NoticeView } from '../result-view';

export const NOTICE_ID = 'result-notice';

// The frame that says why the money came back (or that the question is overdue). It comes before
// the answer in the DOM, and a muted answer points at it with aria-describedby (W3 §4.1).
// The reason is said once for the whole question: the API does not say which card failed.
export function RefundNotice({ notice }: { notice: NoticeView }) {
  const claimable = notice.kind === 'claimable';
  const Icon = claimable ? ClockAlert : RotateCcw;
  return (
    <div
      id={NOTICE_ID}
      className={`flex items-start gap-3 rounded-md border p-4 ${claimable ? 'border-expired/40 bg-expired/12' : 'border-refund/40 bg-refund/12'}`}
    >
      <Icon
        aria-hidden
        className={`mt-0.5 size-5 shrink-0 ${claimable ? 'text-expired' : 'text-refund'}`}
      />
      <div className="flex flex-col gap-1">{lines(notice)}</div>
    </div>
  );
}

function lines(notice: NoticeView) {
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
    case 'generic':
      return <p>{askMessages.refundedGeneric}</p>;
    case 'claimable':
      return <p>{askMessages.statusClaimable}</p>;
  }
}
