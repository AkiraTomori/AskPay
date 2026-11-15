import { TxLink } from '@/components/ui/TxLink';
import { formatDateTimeFullVi, formatDateTimeVi, formatUsdcVi } from '@/lib/format';
import { askMessages } from '../messages';
import type { Badge, ResultView } from '../result-view';
import { StatusBadge } from './StatusBadge';

type Meta = Extract<ResultView, { kind: 'question' }>['meta'];

// Row 1: badge, amount, time. Row 2: the transactions. Anything missing is left out, never blank.
export function ResultMeta({ badge, meta }: { badge: Badge; meta: Meta }) {
  const settleLabel = meta.settleKind === 'refund' ? askMessages.txRefund : askMessages.txPaid;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge badge={badge} />
        {meta.amount !== undefined && (
          <span className="font-medium">{formatUsdcVi(meta.amount)} USDC</span>
        )}
        {meta.createdAt !== undefined && (
          <time
            className="text-sm text-ink-muted"
            dateTime={new Date(meta.createdAt).toISOString()}
            title={formatDateTimeFullVi(meta.createdAt)}
          >
            {formatDateTimeVi(meta.createdAt)}
          </time>
        )}
      </div>
      {(meta.deposit !== undefined || meta.settle !== undefined) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {meta.deposit !== undefined && (
            <TxLink hash={meta.deposit} label={askMessages.txDeposit} />
          )}
          {meta.settle !== undefined && <TxLink hash={meta.settle} label={settleLabel} />}
        </div>
      )}
    </div>
  );
}
