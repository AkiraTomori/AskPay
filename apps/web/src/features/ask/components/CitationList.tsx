import { Info } from 'lucide-react';
import { askMessages } from '../messages';
import type { CitationView } from '../result-view';
import { CitationCard } from './CitationCard';

// Cards in the API's order: that is the order hashed into `citationsHash`. Never sorted.
export function CitationList({
  citations,
  verifying,
  retrying,
}: {
  citations: CitationView[];
  verifying: boolean;
  retrying: boolean;
}) {
  if (citations.length === 0) return null;
  return (
    <section aria-labelledby="citations-heading" className="flex flex-col gap-3">
      <h2 id="citations-heading" className="text-lg font-semibold">
        {askMessages.citationsHeading}
      </h2>
      {verifying && (
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {askMessages.notVerified}
          {retrying && ` ${askMessages.retrying}`}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {citations.map((view, index) => (
          // The list is fixed once the question is closed, so the index is a stable key.
          <li key={index}>
            <CitationCard view={view} />
          </li>
        ))}
      </ul>
    </section>
  );
}
