import type { Metadata } from 'next';
import { Be_Vietnam_Pro, JetBrains_Mono, Noto_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { messages } from '@/lib/messages';
import { Providers } from './providers';
import './globals.css';

// `vietnamese` carries the diacritics; `latin` the base letters and digits.
const sans = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-be-vietnam',
  display: 'swap',
});
const serif = Noto_Serif({
  subsets: ['vietnamese', 'latin'],
  variable: '--font-noto-serif',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['vietnamese', 'latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AskPay',
  description: messages.askTagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
