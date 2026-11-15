import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import type { AnswerView } from '../result-view';

// Plain text only (W3 §5.1): a React text node, so `<b>x</b>` or `**y**` in an answer shows as typed.
// "Muted" is ink-muted text, not opacity: opacity drops the contrast under AA.
export function AnswerBody({
  answer,
  describedBy,
}: {
  answer: AnswerView;
  describedBy: string | undefined;
}) {
  if (answer.skeleton) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  return (
    <p
      aria-describedby={describedBy}
      className={cn('whitespace-pre-line', answer.tone === 'muted' && 'text-ink-muted')}
    >
      {answer.text}
    </p>
  );
}
