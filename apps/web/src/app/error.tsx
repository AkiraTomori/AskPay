'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { messages } from '@/lib/messages';

// Renders inside the root layout, so header, wallet and disclaimer stay in place.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{messages.errorTitle}</h1>
      <p className="mt-2 text-ink-muted">{messages.errorBody}</p>
      <div className="mt-4 flex items-center gap-4">
        <Button onClick={reset}>{messages.retry}</Button>
        <Link href="/" className="underline underline-offset-2">
          {messages.backToAsk}
        </Link>
      </div>
    </>
  );
}
