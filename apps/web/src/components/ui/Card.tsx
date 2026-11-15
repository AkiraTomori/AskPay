import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

type CardProps = ComponentProps<'article'> & {
  // A 3px left edge, like the margin of an official gazette (design-system §4.3).
  accent?: 'seal' | 'refund';
};

const ACCENTS = { seal: 'border-l-seal', refund: 'border-l-refund' } as const;

export function Card({ accent, className, ...rest }: CardProps) {
  return (
    <article
      className={cn(
        'rounded-md border border-rule bg-surface p-4 shadow-card',
        accent && `border-l-[3px] ${ACCENTS[accent]}`,
        className,
      )}
      {...rest}
    />
  );
}
