'use client';

import { fujiDeployment } from '@askpay/shared/abi';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { isSettled } from '@/components/question/status';
import { Address } from '@/components/ui/Address';
import { Button } from '@/components/ui/Button';
import { DisclaimerBanner } from '@/components/layout/DisclaimerBanner';
import { snowtraceAddressUrl } from '@/lib/format';
import { messages } from '@/lib/messages';
import { useApiOverdue, useClaimRefund, useOnChainQuestion, useQuestionProgress } from '../hooks';
import { askMessages } from '../messages';
import { toResultView, type ChainHint, type Refresh } from '../result-view';
import { AnswerBody } from './AnswerBody';
import { CitationList } from './CitationList';
import { ClaimRefundPanel } from './ClaimRefundPanel';
import { NOTICE_ID, RefundNotice } from './RefundNotice';
import { ResultMeta } from './ResultMeta';
import { StepTimeline } from './StepTimeline';

// /questions/[qid] (design W3). All reasoning lives in `toResultView`; this only draws it.
// Wording comes from `status` + `tx.settle`, never from `stage` (P2, AP-07-AC03).
// Two sources, the API for the content and the chain for the money (W5): when they disagree the
// chain wins, and when the API is silent the chain alone can offer the refund (P5).
const CLAIMED_FAST_POLL_MS = 120_000;

export function ResultView({ qid }: { qid: string }) {
  const claim = useClaimRefund(qid);
  const claimed =
    claim.state.kind === 'refunded'
      ? { hash: claim.state.hash, payer: claim.state.payer, byPayer: claim.state.byPayer }
      : undefined;
  const claimedTx = claimed?.hash;
  // The API is asked every 3 s for 2 minutes after our own claim, then back to its usual pace.
  const [fastExpired, setFastExpired] = useState(false);
  useEffect(() => {
    if (claimedTx === undefined) return;
    setFastExpired(false);
    const id = setTimeout(() => setFastExpired(true), CLAIMED_FAST_POLL_MS);
    return () => clearTimeout(id);
  }, [claimedTx]);

  const { question, notFound, loadFailed, isLoading, polling, verifyRetrying, retry } =
    useQuestionProgress(qid, { fast: claimedTx !== undefined && !fastExpired });

  // When to ask the chain (design W5 §2.1): the API gave nothing; the API says CLAIMABLE; or it
  // still says PENDING long after the answer window (indexer lag, §2.1 #3).
  // "Still open" for the API: no closed status, or a closed one without the settlement tx (the
  // indexer has not read the event). Past the window either may be behind the chain.
  const pending =
    question !== undefined &&
    question.status !== 'CLAIMABLE' &&
    question.stage !== 'QUOTED' &&
    question.stage !== 'EXPIRED' &&
    !isSettled(question);
  const overdue = useApiOverdue(pending ? question.createdAt : undefined);
  const askChain =
    (question === undefined && (notFound || loadFailed)) ||
    question?.status === 'CLAIMABLE' ||
    (pending && overdue);
  const { read: chain, refetch: refetchChain } = useOnChainQuestion(qid, askChain);

  const view = toResultView({
    qid,
    result: question,
    notFound,
    loadFailed,
    polling,
    chain,
    claimed,
  });

  // Focus moves to the notice when a claim succeeds, so a keyboard or screen-reader user lands on it.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (claimedTx !== undefined) noticeRef.current?.focus();
  }, [claimedTx]);

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
      return <Message text={askMessages.notFound} chain={view.chain} />;
    case 'notHeld':
      return <Message text={askMessages.notHeldPage} />;
    case 'loadFailed':
      return (
        <div className="flex flex-col items-start gap-3">
          <p>{askMessages.loadFailed}</p>
          <ChainLine chain={view.chain} />
          <Button
            onClick={() => {
              void retry();
              refetchChain();
            }}
          >
            {askMessages.retry}
          </Button>
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
          <h1 className="mt-1 break-words text-2xl font-semibold">{view.question}</h1>
        </div>
        {view.source === 'chain' && <ChainSource />}
        <ResultMeta badge={view.badge} meta={view.meta} />
        <RefreshLine refresh={view.refresh} onRetry={() => void retry()} />
      </header>

      {view.timeline && <StepTimeline {...view.timeline} announce={!view.settled} />}
      {/* One polite region for the badge, so the page is not read again on every poll. */}
      <p aria-live="polite" className="sr-only">
        {view.badge === 'pending'
          ? ''
          : view.badge === 'expired' && view.source === 'chain'
            ? askMessages.deadlineReached
            : askMessages.badgeAnnounce[view.badge]}
      </p>

      {view.notice && (
        <RefundNotice
          notice={view.notice}
          focusRef={noticeRef}
          panel={
            view.notice.kind === 'claimable' ? (
              <ClaimRefundPanel
                claim={view.notice.claim}
                state={claim.state}
                onClaim={() => void claim.claim()}
                blockTime={claim.blockTime}
              />
            ) : undefined
          }
        />
      )}

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

function Message({ text, chain }: { text: string; chain?: ChainHint | undefined }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status">{text}</p>
      <ChainLine chain={chain} />
      <Link href="/" className="underline">
        {messages.backToAsk}
      </Link>
    </div>
  );
}

// What the page says while it reads the chain, or when that failed too.
function ChainLine({ chain }: { chain: ChainHint | undefined }) {
  if (chain === 'reading')
    return <p className="text-sm text-ink-muted">{askMessages.chainReading}</p>;
  if (chain === 'failed')
    return <p className="text-sm text-ink-muted">{askMessages.chainFailed}</p>;
  return null;
}

// Tells the reader these numbers did not come from the AskPay server (design W5 §2.2).
function ChainSource() {
  return (
    <section
      aria-labelledby="chain-source-heading"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted"
    >
      <h2 id="chain-source-heading" className="font-medium">
        {askMessages.chainSourceTitle}
      </h2>
      <Address
        address={fujiDeployment.address}
        href={snowtraceAddressUrl(fujiDeployment.address)}
      />
    </section>
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
