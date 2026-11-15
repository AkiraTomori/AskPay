import { ExternalLink } from 'lucide-react';
import { messages } from '@/lib/messages';
import { shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

type AddressProps = {
  address: string;
  // When set, the address renders as an external link (opens in a new tab).
  href?: string;
  className?: string;
};

// Shortened address in mono; the full value is always in the title.
export function Address({ address, href, className }: AddressProps) {
  const text = shortAddress(address);
  if (href === undefined) {
    return (
      <span title={address} className={cn('font-mono', className)}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={href}
      title={address}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 font-mono underline underline-offset-2',
        className,
      )}
    >
      {text}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">{messages.opensInNewTab}</span>
    </a>
  );
}
