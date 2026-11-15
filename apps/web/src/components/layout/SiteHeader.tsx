'use client';

import { Scale } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { NetworkChip } from '@/components/wallet/NetworkChip';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { MobileNav } from './MobileNav';
import { NAV_ITEMS } from './nav-items';

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="relative border-b border-rule bg-paper">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          <Scale aria-hidden className="size-6 text-seal" />
          {/* Below 400px the wordmark gives way to the network chip and the wallet button. */}
          <span className="max-[400px]:sr-only">AskPay</span>
        </Link>
        <nav aria-label={messages.mainNav} className="ml-4 hidden sm:block">
          <ul className="flex gap-4">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={cn(
                    'underline-offset-4 hover:underline',
                    pathname === item.href && 'font-semibold underline',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <NetworkChip />
          <ConnectButton />
          <MobileNav pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
