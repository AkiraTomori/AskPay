import { ExternalLink } from 'lucide-react';
import { messages } from '@/lib/messages';
import type { EvalView } from '../dashboard-view';
import { dashboardMessages as m } from '../messages';

// AP-09-AC03. The caller renders nothing (not even the heading) when there is no eval.
export function EvalPanel({ view }: { view: EvalView }) {
  return (
    <section aria-labelledby="eval-heading" className="flex flex-col gap-3">
      <h2 id="eval-heading" className="text-lg font-semibold">
        {m.evalTitle}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {view.metrics.map((metric) => (
          <div key={metric.key} className="flex flex-col gap-1">
            <dt className="text-sm text-ink-muted">{metric.label}</dt>
            <dd className="text-2xl font-semibold">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
        <span>{m.evalRun(view.runDate)}</span>
        <span aria-hidden>·</span>
        <span>{m.evalCommit}</span>
        {view.commitUrl ? (
          <a
            href={view.commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-ink underline underline-offset-2"
          >
            {view.commit}
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">{messages.opensInNewTab}</span>
          </a>
        ) : (
          <span className="font-mono text-ink">{view.commit}</span>
        )}
      </p>
      <p className="text-sm text-ink-muted">{m.evalNote}</p>
    </section>
  );
}
