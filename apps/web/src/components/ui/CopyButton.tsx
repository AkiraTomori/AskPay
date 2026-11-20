'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { messages as m } from '@/lib/messages';

// Copies `text`; the label says "Đã sao chép" for 2 seconds. `what` names the thing for a screen
// reader ("Sao chép lawId"); the visible label starts with the same word (WCAG 2.5.3).
export function CopyButton({
  text,
  what,
  className,
}: {
  text: string;
  what: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard blocked: leave the label unchanged rather than claim success
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button
        type="button"
        aria-label={m.copyOf(what)}
        onClick={() => void copy()}
        className={cn(
          'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-ink-muted bg-surface px-3 text-sm font-medium hover:bg-paper',
          className,
        )}
      >
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {copied ? m.copied : m.copy}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? m.copied : ''}
      </span>
    </>
  );
}
