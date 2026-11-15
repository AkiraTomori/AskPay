import { BadgeCheck, ClockAlert, LoaderCircle, RotateCcw, type LucideIcon } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/Badge';
import { askMessages } from '../messages';
import type { Badge as BadgeKind } from '../result-view';

const BADGES: Record<BadgeKind, { tone: Tone; icon: LucideIcon }> = {
  pending: { tone: 'pending', icon: LoaderCircle },
  paid: { tone: 'paid', icon: BadgeCheck },
  refunded: { tone: 'refund', icon: RotateCcw },
  expired: { tone: 'expired', icon: ClockAlert },
};

// Wording comes from the badge, which result-view derives from `status` + `tx.settle` (P2).
export function StatusBadge({ badge }: { badge: BadgeKind }) {
  const { tone, icon } = BADGES[badge];
  return (
    <Badge tone={tone} icon={icon} spin={badge === 'pending'}>
      {askMessages.badge[badge]}
    </Badge>
  );
}
