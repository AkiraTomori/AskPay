import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { FAUCET_URL } from '@/lib/constants';
import { messages } from '@/lib/messages';
import type { NoticeView } from '../ask-view';
import { askMessages } from '../messages';

// The single live region for everything the form has to say. Always mounted (and empty when
// there is nothing to say) so a screen reader announces text when it appears.
// Blocking errors use colour AND an icon; a cancelled signature is not an error and stays muted.
export function AskNotice({ notice }: { notice: NoticeView | null }) {
  return (
    <div role="status" aria-live="polite" className="min-h-6 text-sm">
      {notice && (
        <p className={notice.tone === 'error' ? 'flex gap-2 text-error' : 'text-ink-muted'}>
          {notice.tone === 'error' && (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {notice.text}
            {notice.faucet && (
              <>
                {' '}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="underline">
                  {askMessages.getTestUsdc} ↗{' '}
                  <span className="sr-only">{messages.opensInNewTab}</span>
                </a>
              </>
            )}
            {notice.questionHref && (
              <>
                {' '}
                <Link href={notice.questionHref} className="underline">
                  {askMessages.openQuestion}
                </Link>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
