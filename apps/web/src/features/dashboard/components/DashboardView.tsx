'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { toStatsView } from '../dashboard-view';
import { useStats } from '../hooks';
import { dashboardMessages as m } from '../messages';
import { BlockError } from './BlockError';
import { EvalPanel } from './EvalPanel';
import { ProvenanceNote } from './ProvenanceNote';
import { RecentQuestions } from './RecentQuestions';
import { RefundReasonList } from './RefundReasonList';
import { StatTiles } from './StatTiles';
import { LoadError } from '../api';

// /dashboard (design W4). Public, read-only: no wallet is needed or asked for. The numbers and the
// table load independently, so one failing does not hide the other.
export function DashboardView() {
  const stats = useStats();
  const view = stats.data ? toStatsView(stats.data) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{m.title}</h1>
        <p className="text-ink-muted">{m.intro}</p>
      </header>

      {view ? (
        <>
          <section aria-label={m.statsLabel} className="flex flex-col gap-3">
            <StatTiles tiles={view.tiles} />
            <ProvenanceNote block={view.block} reconnecting={stats.isError} />
          </section>
          <section aria-labelledby="reasons-heading" className="flex flex-col gap-3">
            <h2 id="reasons-heading" className="text-lg font-semibold">
              {m.reasonsTitle}
            </h2>
            <RefundReasonList reasons={view.reasons} />
          </section>
          {view.eval && <EvalPanel view={view.eval} />}
        </>
      ) : stats.isError ? (
        <BlockError
          message={m.statsFailed}
          code={stats.error instanceof LoadError ? stats.error.code : undefined}
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <StatsSkeleton />
      )}

      <RecentQuestions questionCount={stats.data?.questions} />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{m.loading}</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}
