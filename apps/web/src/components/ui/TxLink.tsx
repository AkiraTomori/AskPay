import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { shortHash, snowtraceTxUrl } from '@/lib/format';
import { messages } from '@/lib/messages';

type TxLinkProps = { hash: string; label?: string; className?: string };

// A transaction on Snowtrace: short hash in mono, the full hash in the title, a new tab.
export function TxLink({ hash, label, className }: TxLinkProps) {
  return (
    <a
      href={snowtraceTxUrl(hash)}
      title={hash}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 underline underline-offset-2', className)}
    >
      {label !== undefined && <span>{label}:</span>}
      <span className="font-mono">{shortHash(hash)}</span>
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">{messages.opensInNewTab}</span>
    </a>
  );
}
