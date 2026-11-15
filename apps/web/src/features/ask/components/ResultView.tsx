'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { DisclaimerBanner } from '@/components/layout/DisclaimerBanner';
import { messages } from '@/lib/messages';
import { useQuestionProgress } from '../hooks';
import { askMessages } from '../messages';
import { toResultView, type Refresh } from '../result-view';
import { AnswerBody } from './AnswerBody';
import { CitationList } from './CitationList';
import { NOTICE_ID, RefundNotice } from './RefundNotice';
import { ResultMeta } from './ResultMeta';
import { StepTimeline } from './StepTimeline';

// /questions/[qid] (design W3). All reasoning lives in `toResultView`; this only draws it.
// Wording comes from `status` + `tx.settle`, never from `stage` (P2, AP-07-AC03).
export function ResultView({ qid }: { qid: string }) {
  const { question, notFound, loadFailed, isLoading, polling, verifyRetrying, retry } =
    useQuestionProgress(qid);
  const view = toResultView({ result: question, notFound, loadFailed, polling });

  // The tab title is the question. Leaving the page puts the previous title back, so the next page
  // (and the browser history entry) does not keep this question's title.
  const title = view.kind === 'question' || view.kind === 'notHeld' ? view.question : undefined;
  useEffect(() => {
    if (title === undefined) return;
    const previous = document.title;
    document.title = askMessages.pageTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);

  switch (view.kind) {
    case 'loading':
      // First load: the answer frame as a skeleton (design W3 §4), disclaimer already in place.
      return (
        <div className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            {isLoading ? askMessages.loading : ''}
          </p>
          <AnswerBody answer={{ skeleton: true }} describedBy={undefined} />
          <DisclaimerBanner variant="inline" />
        </div>
      );
    case 'notFound':
      return <Message text={askMessages.notFound} />;
    case 'notHeld':
      return <Message text={askMessages.notHeldPage} />;
    case 'loadFailed':
      return (
        <div className="flex flex-col items-start gap-3">
          <p>{askMessages.loadFailed}</p>
          <Button onClick={() => void retry()}>{askMessages.retry}</Button>
        </div>
      );
    case 'question':
      break;
  }

  const warnsAnswer =
    view.notice !== undefined && 'warnsAnswer' in view.notice && view.notice.warnsAnswer;
  const mutedAnswer =
    view.answer !== undefined && !view.answer.skeleton && view.answer.tone === 'muted';
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-ink-muted">{askMessages.yourQuestion}</p>
          <h1 className="mt-1 text-2xl font-semibold">{view.question}</h1>
        </div>
        <ResultMeta badge={view.badge} meta={view.meta} />
        <RefreshLine refresh={view.refresh} onRetry={() => void retry()} />
      </header>

      {view.timeline && <StepTimeline {...view.timeline} announce={!view.settled} />}
      {/* One polite region for the badge, so the page is not read again on every poll. */}
      <p aria-live="polite" className="sr-only">
        {view.badge === 'pending' ? '' : askMessages.badgeAnnounce[view.badge]}
      </p>

      {view.notice && <RefundNotice notice={view.notice} />}

      {view.answer && (
        <section aria-labelledby="answer-heading" className="flex flex-col gap-3">
          <h2 id="answer-heading" className="text-lg font-semibold">
            {askMessages.answerHeading}
          </h2>
          <AnswerBody
            answer={view.answer}
            describedBy={mutedAnswer && warnsAnswer ? NOTICE_ID : undefined}
          />
          <DisclaimerBanner variant="inline" />
        </section>
      )}

      <CitationList
        citations={view.citations}
        verifying={view.verifying}
        retrying={verifyRetrying}
      />

      {view.actions.length > 0 && (
        <div>
          {view.actions.map((action) =>
            action === 'askAgain' ? (
              <Link
                key={action}
                href={`/?q=${encodeURIComponent(view.question)}`}
                className={linkButton}
              >
                {askMessages.askAgain}
              </Link>
            ) : (
              <Link key={action} href="/" className={linkButton}>
                {askMessages.askAnother}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// The look of Button `secondary`, on a link: both go to `/`.
const linkButton =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-ink-muted bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-paper';

function Message({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status">{text}</p>
      <Link href="/" className="underline">
        {messages.backToAsk}
      </Link>
    </div>
  );
}

// One small line when the screen may be behind the server. A stopped page offers a retry instead
// of saying it is "retrying".
function RefreshLine({ refresh, onRetry }: { refresh: Refresh; onRetry: () => void }) {
  if (refresh === 'live') return null;
  if (refresh === 'retrying') {
    return <p className="text-sm text-ink-muted">{askMessages.reconnecting}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
      <p>{refresh === 'lostConnection' ? askMessages.connectionLost : askMessages.settleStalled}</p>
      <Button variant="secondary" onClick={onRetry}>
        {askMessages.retry}
      </Button>
    </div>
  );
}
