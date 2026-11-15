import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

// ComponentProps (not ButtonHTMLAttributes) so React 19's `ref` prop is accepted.
type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant;
  loading?: boolean;
};

const variants: Record<Variant, string> = {
  primary: 'bg-seal text-seal-ink hover:brightness-110',
  // The border carries meaning (it is the button's edge), so it must reach 3:1: ink-muted, not rule.
  secondary: 'border border-ink-muted bg-surface text-ink hover:bg-paper',
  ghost: 'text-ink hover:bg-rule/60',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
