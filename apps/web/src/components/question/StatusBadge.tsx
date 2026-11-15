import { BadgeCheck, ClockAlert, LoaderCircle, RotateCcw, type LucideIcon } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/Badge';
import { BADGE_LABELS, type Badge as BadgeKind } from './status';

const BADGES: Record<BadgeKind, { tone: Tone; icon: LucideIcon }> = {
  pending: { tone: 'pending', icon: LoaderCircle },
  paid: { tone: 'paid', icon: BadgeCheck },
  refunded: { tone: 'refund', icon: RotateCcw },
  expired: { tone: 'expired', icon: ClockAlert },
};

// Wording comes from the badge, which `badgeOf` / result-view derive from `status` + `tx.settle` (P2).
export function StatusBadge({ badge }: { badge: BadgeKind }) {
  const { tone, icon } = BADGES[badge];
  return (
    <Badge tone={tone} icon={icon} spin={badge === 'pending'}>
      {BADGE_LABELS[badge]}
    </Badge>
  );
}
