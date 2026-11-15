import type { ReactNode } from 'react';
import { NetworkGuard } from '@/components/wallet/NetworkGuard';
import { messages } from '@/lib/messages';
import { DisclaimerBanner } from './DisclaimerBanner';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

// DOM order is also Tab order: skip link, network guard, header, main, disclaimer, footer.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-30 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        {messages.skipToContent}
      </a>
      <NetworkGuard />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
      <DisclaimerBanner />
      <SiteFooter />
    </div>
  );
}
