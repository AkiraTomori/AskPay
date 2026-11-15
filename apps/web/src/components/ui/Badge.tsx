import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'paid' | 'pending' | 'refund' | 'expired';

// The tint and the icon carry the tone; the label is always `ink`. Same-tone text only reaches
// 4.07:1 (refund) and 4.28:1 (expired) on the tinted fill, under AA for 12px text (W3 U-11).
// Literal class names so Tailwind can see them.
const TONES: Record<Tone, { fill: string; icon: string }> = {
  paid: { fill: 'bg-paid/12', icon: 'text-paid' },
  pending: { fill: 'bg-pending/12', icon: 'text-pending' },
  refund: { fill: 'bg-refund/12', icon: 'text-refund' },
  expired: { fill: 'bg-expired/12', icon: 'text-expired' },
};

type BadgeProps = {
  tone: Tone;
  icon: LucideIcon;
  spin?: boolean;
  children: ReactNode;
  className?: string;
};

export function Badge({ tone, icon: Icon, spin = false, children, className }: BadgeProps) {
  const style = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink',
        style.fill,
        className,
      )}
    >
      <Icon aria-hidden className={cn('size-4', style.icon, spin && 'animate-spin')} />
      {children}
    </span>
  );
}
