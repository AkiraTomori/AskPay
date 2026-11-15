import { messages } from '@/lib/messages';

// W1 only provides the shell. The question form and `useAsk` arrive with W2.
export default function AskPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">{messages.askTitle}</h1>
      <p className="mt-2 text-ink-muted">{messages.askTagline}</p>
    </>
  );
}
