import { Info } from 'lucide-react';
import { messages } from '@/lib/messages';

// AP-07-AC04: always visible. No close button, no dependency on wallet or API state, never
// hidden at any breakpoint. It is a labelled landmark (complementary) so screen-reader users can
// jump to it. Rendered by the root layout (and again by global-error.tsx, which
// replaces the layout), so every route has it.
//
// `inline` is the repeat right under an answer (W1 U-01, W3 §9). It is a plain paragraph, not a
// second landmark, so a screen reader still finds exactly one "Lưu ý pháp lý".
export function DisclaimerBanner({ variant = 'banner' }: { variant?: 'banner' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {messages.disclaimer}
      </p>
    );
  }
  return (
    <aside aria-label={messages.disclaimerLabel} className="border-t border-rule bg-paper">
      <p className="mx-auto flex max-w-3xl items-start gap-2 px-4 py-3 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {messages.disclaimer}
      </p>
    </aside>
  );
}
