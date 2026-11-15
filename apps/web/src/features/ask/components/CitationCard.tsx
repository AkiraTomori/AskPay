import { Card } from '@/components/ui/Card';
import { askMessages } from '../messages';
import { locateQuote } from '../quote-match';
import type { CitationView } from '../result-view';
import { VerifiedMark } from './VerifiedMark';

// One cited Khoản. Everything from the API renders as plain text (no HTML, no markdown).
export function CitationCard({ view }: { view: CitationView }) {
  const { citation, tone, verified } = view;
  const title = askMessages.khoanTitle(citation.dieu, citation.khoan, citation.dieuTitle);
  return (
    <Card accent={tone === 'paid' ? 'seal' : 'refund'} className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <blockquote className="font-serif italic leading-[1.75]">“{citation.quote}”</blockquote>
      {verified && <VerifiedMark />}
      <FullText text={citation.text} quote={citation.quote} expectMatch={tone === 'paid'} />
    </Card>
  );
}

function FullText({
  text,
  quote,
  expectMatch,
}: {
  text: string;
  quote: string;
  expectMatch: boolean;
}) {
  if (text === '') {
    return <p className="text-sm text-ink-muted">{askMessages.fullTextMissing}</p>;
  }
  // The range indexes the NFC form, so that is the string shown.
  const shown = text.normalize('NFC');
  const range = locateQuote(shown, quote);
  if (!range && expectMatch && process.env.NODE_ENV !== 'production') {
    console.warn('CitationCard: a paid quote was not found in its own text');
  }
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer text-sm underline underline-offset-2">
        {askMessages.showFullText}
      </summary>
      <p className="mt-2 whitespace-pre-line font-serif leading-[1.75]">
        {range ? (
          <>
            {shown.slice(0, range.start)}
            <span className="sr-only">{askMessages.quotedPart}: </span>
            <mark className="bg-seal/12 text-ink">{shown.slice(range.start, range.end)}</mark>
            {shown.slice(range.end)}
          </>
        ) : (
          shown
        )}
      </p>
    </details>
  );
}
