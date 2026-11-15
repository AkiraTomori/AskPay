import { BadgeCheck } from 'lucide-react';
import { askMessages } from '../messages';

// The two-line mark of AP-07-AC02 (Q-10). One component, both lines, no prop to show only the
// first: the main line alone would say the blockchain checked the quote, and it did not (the
// checker signed that part).
export function VerifiedMark() {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-medium text-paid">
        <BadgeCheck aria-hidden className="size-4 shrink-0" />
        {askMessages.verifiedMain}
      </p>
      <p className="pl-[22px] text-sm text-ink-muted">{askMessages.verifiedSub}</p>
    </div>
  );
}
