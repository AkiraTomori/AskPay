'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { NAV_ITEMS } from './nav-items';

// Below 640px the nav folds into a button. The network chip and wallet button stay outside it:
// they are state the user always needs to see.
export function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Navigating closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="sm:hidden" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? messages.closeMenu : messages.menu}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 items-center justify-center rounded-md border border-ink-muted bg-surface"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      {open && (
        <nav
          id={panelId}
          aria-label={messages.mainNav}
          className="absolute inset-x-0 top-full z-10 border-b border-rule bg-paper px-4 py-2"
        >
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={cn('block py-2', pathname === item.href && 'font-semibold')}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
