'use client';

import { BLLD_2019_LAW_ID } from '@askpay/shared/leaf';
import corpusMeta from '@askpay/corpus/meta';
import { BadgeCheck, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { useOnChainLaw } from '../hooks';
import { verifyMessages as m } from '../messages';
import { lawVerdict, type LawVerdict } from '../verify-view';

const REPO_ROOT = corpusMeta.root as `0x${string}`;

const BADGES: Record<
  Exclude<LawVerdict['kind'], 'failed' | 'loading'>,
  { tone: Tone; icon: typeof BadgeCheck; label: string; text: string }
> = {
  match: { tone: 'paid', icon: BadgeCheck, label: `✓ ${m.match}`, text: m.matchText },
  mismatch: { tone: 'refund', icon: TriangleAlert, label: `✗ ${m.mismatch}`, text: m.mismatchText },
  unregistered: {
    tone: 'expired',
    icon: CircleHelp,
    label: m.unregistered,
    text: m.unregisteredText,
  },
};

// The law: the root of this repo's text against the root registered on the contract. The browser
// reads the contract and compares; "failed" never shows ✓ or ✗.
export function LawCard() {
  const { root, retry } = useOnChainLaw();
  const verdict = lawVerdict(REPO_ROOT, root);
  const shown =
    verdict.kind === 'loading' || verdict.kind === 'failed' ? undefined : BADGES[verdict.kind];

  return (
    <section
      aria-labelledby="law-heading"
      className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="law-heading" className="text-lg font-semibold">
          {m.lawTitle}
        </h2>
        {shown ? (
          <Badge tone={shown.tone} icon={shown.icon}>
            {shown.label}
          </Badge>
        ) : verdict.kind === 'loading' ? (
          <Badge tone="pending" icon={LoaderCircle} spin>
            …
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">
        {corpusMeta.lawName} · {m.lawCounts(corpusMeta.dieuCount, corpusMeta.khoanCount)}
      </p>

      <Row label={m.lawId} value={BLLD_2019_LAW_ID} copyWhat={m.lawId} />
      <Row label={m.repoRoot} value={REPO_ROOT} copyWhat={m.repoRoot} />
      {root.kind === 'data' ? (
        <Row label={m.chainRoot} value={root.root} copyWhat={m.chainRoot} />
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{m.chainRoot}</p>
          {root.kind === 'loading' ? <Skeleton className="h-6 w-full" /> : null}
        </div>
      )}

      <div role="status" aria-live="polite" className="text-sm">
        {shown ? <p>{shown.text}</p> : null}
        {verdict.kind === 'failed' && (
          <div className="flex flex-wrap items-center gap-3">
            <p>{m.readFailed}</p>
            <Button variant="secondary" onClick={retry}>
              {m.retry}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// The full hash wraps (break-all) so a phone does not scroll sideways; Copy puts it on the clipboard.
function Row({ label, value, copyWhat }: { label: string; value: string; copyWhat: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
        <CopyButton text={value} what={copyWhat} />
      </div>
    </div>
  );
}
