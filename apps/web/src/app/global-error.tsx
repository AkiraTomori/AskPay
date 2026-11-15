'use client';

import { DisclaimerBanner } from '@/components/layout/DisclaimerBanner';
import { messages } from '@/lib/messages';
import './globals.css';

// Replaces the whole root layout when it fails, so it brings its own <html> and its own
// DisclaimerBanner (AP-07-AC04). No wallet or fonts here: the layout that provides them is gone.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body className="flex min-h-dvh flex-col bg-paper font-sans text-ink">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <h1 className="text-2xl font-semibold">{messages.errorTitle}</h1>
          <p className="mt-2 text-ink-muted">{messages.errorBody}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 min-h-10 rounded-md bg-seal px-4 text-sm font-medium text-seal-ink"
          >
            {messages.retry}
          </button>
        </main>
        <DisclaimerBanner />
      </body>
    </html>
  );
}
