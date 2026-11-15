'use client';

import { Check, ChevronDown, Copy, ExternalLink, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Address } from 'viem';
import { useDisconnect } from 'wagmi';
import { Skeleton } from '@/components/ui/Skeleton';
import { FAUCET_URL, WALLET_BUTTON_ID } from '@/lib/constants';
import { formatUsdcVi, shortAddress, snowtraceAddressUrl } from '@/lib/format';
import { messages } from '@/lib/messages';

export type BalanceView =
  | { kind: 'hidden' } // wrong network
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'value'; usdc: bigint };

type AccountMenuProps = { address: Address; balance: BalanceView };

const itemClass =
  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-paper focus-visible:bg-paper';

export function AccountMenu({ address, balance }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const menuId = useId();
  const { mutate: disconnect } = useDisconnect();

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const items = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // Click or touch outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Let focus move on naturally; the menu just closes behind it.
        setOpen(false);
        break;
    }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return; // clipboard blocked: leave the label unchanged rather than claim success
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={WALLET_BUTTON_ID}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={address}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-ink-muted bg-surface px-2 text-sm sm:gap-2 sm:px-3 hover:bg-paper"
      >
        <span className="hidden whitespace-nowrap font-mono sm:inline">
          {shortAddress(address)}
        </span>
        <span className="whitespace-nowrap font-mono sm:hidden">{shortAddress(address, 4, 2)}</span>
        <BalanceInline balance={balance} />
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute right-0 z-20 mt-2 w-72 rounded-md border border-rule bg-surface p-2 shadow-card"
        >
          <p className="break-all px-3 py-2 font-mono text-sm">{address}</p>
          {balance.kind === 'value' && (
            <p className="px-3 pb-2 text-sm text-ink-muted">
              {messages.balance}: {formatUsdcVi(balance.usdc)} USDC
            </p>
          )}
          <div ref={panelRef} id={menuId} role="menu" aria-label={messages.accountMenu}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              onClick={copyAddress}
            >
              {copied ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
              <span aria-live="polite">{copied ? messages.copied : messages.copyAddress}</span>
            </button>
            <MenuLink href={snowtraceAddressUrl(address)}>{messages.viewOnSnowtrace}</MenuLink>
            <MenuLink href={FAUCET_URL}>{messages.getTestUsdc}</MenuLink>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              <LogOut aria-hidden className="size-4" />
              {messages.disconnect}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      role="menuitem"
      tabIndex={-1}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={itemClass}
    >
      <ExternalLink aria-hidden className="size-4" />
      {children}
      <span className="sr-only">{messages.opensInNewTab}</span>
    </a>
  );
}

// Hidden below 640px: the balance is then only in the menu (design W1 §6.2).
function BalanceInline({ balance }: { balance: BalanceView }) {
  switch (balance.kind) {
    case 'hidden':
      return null;
    case 'loading':
      return <Skeleton className="hidden h-4 w-14 sm:block" />;
    case 'error':
      return (
        <span className="hidden text-ink-muted sm:inline" title={messages.balanceUnavailable}>
          — USDC
        </span>
      );
    case 'value':
      return <span className="hidden sm:inline">{formatUsdcVi(balance.usdc)} USDC</span>;
  }
}
