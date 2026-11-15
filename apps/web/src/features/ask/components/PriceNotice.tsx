import { formatUsdcVi, formatVndEstimate } from '@/lib/format';
import { askMessages } from '../messages';
import type { Quote } from '../payment';

function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// The price is on screen before the wallet is ever asked (AP-02-AC03). The countdown is not a live
// region: it would be read out every second. AskNotice announces the 30-second mark once.
export function PriceNotice({
  quote,
  remainingMs,
}: {
  quote: Quote;
  remainingMs: number | undefined;
}) {
  const amount = BigInt(quote.requirement.amount);
  return (
    <section
      aria-label={askMessages.priceLabel}
      className="rounded-md border border-rule bg-surface p-4 shadow-card"
    >
      <p className="flex flex-wrap items-baseline gap-x-3">
        <strong className="text-lg font-semibold">{formatUsdcVi(amount)} USDC</strong>
        <span className="text-ink-muted">{askMessages.vndEstimate(formatVndEstimate(amount))}</span>
      </p>
      <p className="mt-2 text-sm">{askMessages.escrowNote}</p>
      <p className="text-sm">{askMessages.refundNote}</p>
      {remainingMs !== undefined && (
        <p className="mt-2 text-sm text-ink-muted">
          {askMessages.quoteCountdown(mmss(remainingMs))}
        </p>
      )}
    </section>
  );
}
