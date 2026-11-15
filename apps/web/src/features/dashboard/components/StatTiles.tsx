import { BadgeCheck, RotateCcw, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { StatsView, Tile } from '../dashboard-view';

// Four equal tiles, no hero number (design W4 §4). Each is a <dl>: "Câu hỏi, 42".
function StatTile({ tile, icon: Icon }: { tile: Tile; icon?: LucideIcon }) {
  return (
    <Card>
      <dl className="flex flex-col gap-1">
        <dt className="flex items-center gap-1.5 text-sm text-ink-muted">
          {Icon && <Icon aria-hidden className="size-4" />}
          {tile.label}
        </dt>
        <dd className="break-words text-2xl font-semibold text-ink sm:text-[32px] sm:leading-10">
          {tile.value}
          {tile.unit !== undefined && (
            <>
              {' '}
              <span className="text-base font-medium text-ink-muted">{tile.unit}</span>
            </>
          )}
        </dd>
        {tile.sub !== undefined && <dd className="text-sm text-ink-muted">{tile.sub}</dd>}
      </dl>
    </Card>
  );
}

export function StatTiles({ tiles }: { tiles: StatsView['tiles'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 lg:grid-cols-4">
      <StatTile tile={tiles.questions} />
      <StatTile tile={tiles.paid} icon={BadgeCheck} />
      <StatTile tile={tiles.refunded} icon={RotateCcw} />
      <StatTile tile={tiles.revenue} />
    </div>
  );
}
