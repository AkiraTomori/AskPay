import Link from 'next/link';
import { messages } from '@/lib/messages';

export default function NotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold">{messages.notFoundTitle}</h1>
      <p className="mt-4">
        <Link href="/" className="underline underline-offset-2">
          {messages.backToAsk}
        </Link>
      </p>
    </>
  );
}
