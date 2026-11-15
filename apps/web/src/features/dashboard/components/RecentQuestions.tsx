'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useRecentQuestions } from '../hooks';
import { dashboardMessages as m } from '../messages';
import { BlockError } from './BlockError';
import { QuestionTable } from './QuestionTable';

const linkButton =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-ink-muted bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-paper';

// "Câu hỏi gần nhất": loading, failed (not the same as empty), empty, rows + "Xem thêm".
// `questionCount` is the on-chain count from /stats, to tell "no questions" from "none to show".
export function RecentQuestions({ questionCount }: { questionCount: number | undefined }) {
  const recent = useRecentQuestions();
  const { rows, loadState, lastLoad } = recent;

  // A live region only speaks when its text changes, so a second load of the same size would be
  // silent. Clear it first, then set the text a moment later.
  const [announcement, setAnnouncement] = useState('');
  const seq = lastLoad?.seq;
  const added = lastLoad?.added;
  useEffect(() => {
    if (seq === undefined || added === undefined) return;
    setAnnouncement('');
    const timer = setTimeout(() => setAnnouncement(m.loadedMore(added)), 100);
    return () => clearTimeout(timer);
  }, [seq, added]);

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
      <h2 id="recent-heading" className="text-lg font-semibold">
        {m.recentTitle}
      </h2>
      {recent.pending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{m.loading}</span>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : recent.failed ? (
        <BlockError message={m.listFailed} code={recent.errorCode} onRetry={recent.retry} />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p>{questionCount !== undefined && questionCount > 0 ? m.emptyButCounted : m.empty}</p>
          <Link href="/" className={linkButton}>
            {m.askFirst}
          </Link>
        </div>
      ) : (
        <>
          <QuestionTable
            items={rows}
            focusQid={lastLoad && { seq: lastLoad.seq, qid: lastLoad.firstQid }}
          />
          {recent.nextCursor !== undefined && (
            <div className="flex flex-col items-center gap-2">
              {loadState === 'failed' && (
                <p role="alert" className="text-sm text-error">
                  {m.loadMoreFailed}
                </p>
              )}
              <Button
                variant="secondary"
                loading={loadState === 'loading'}
                onClick={() => void recent.loadMore()}
              >
                {loadState === 'loading' ? m.loadingMore : m.loadMore}
              </Button>
            </div>
          )}
        </>
      )}
      {/* The one live region of the page: numbers that refresh by themselves are not announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
