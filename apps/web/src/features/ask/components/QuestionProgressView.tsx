'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { messages } from '@/lib/messages';
import { useQuestionProgress } from '../hooks';
import { askMessages } from '../messages';
import { StepTimeline } from './StepTimeline';

// Minimal /questions/[qid] for W2 (design §8.1): the question, the steps and one status line.
// W3 replaces the status line with StatusBadge and adds the answer, citations and tx links.
// The wording comes from `status` only, never from `stage` (P2).
export function QuestionProgressView({ qid }: { qid: string }) {
  const { question, notFound, loadFailed, isLoading, refetch } = useQuestionProgress(qid);

  if (notFound) return <Message text={askMessages.notFound} />;
  if (!question) {
    if (loadFailed) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p>{askMessages.loadFailed}</p>
          <Button onClick={() => void refetch()}>{askMessages.retry}</Button>
        </div>
      );
    }
    return <p role="status">{isLoading ? askMessages.loading : ''}</p>;
  }

  const { status, stage } = question;
  if (status === undefined && (stage === 'QUOTED' || stage === 'EXPIRED')) {
    return <Message text={askMessages.notHeldPage} />;
  }
  const line =
    status === 'PAID'
      ? askMessages.statusPaid
      : status === 'REFUNDED'
        ? askMessages.statusRefunded
        : status === 'CLAIMABLE'
          ? askMessages.statusClaimable
          : askMessages.statusPending;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="text-sm font-medium text-ink-muted">{askMessages.yourQuestion}</h2>
        <p className="mt-1">{question.question}</p>
      </section>
      {status !== 'CLAIMABLE' && (
        <StepTimeline
          stage={stage}
          status={status}
          reason={question.reason}
          settleTx={question.tx?.settle}
        />
      )}
      <p role="status" className="font-medium">
        {line}
      </p>
    </div>
  );
}

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
