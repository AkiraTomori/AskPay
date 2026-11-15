import { AskForm } from '@/features/ask/components/AskForm';
import { messages } from '@/lib/messages';

export default function AskPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">{messages.askTitle}</h1>
      <p className="mt-2 text-ink-muted">{messages.askTagline}</p>
      <AskForm />
    </>
  );
}
