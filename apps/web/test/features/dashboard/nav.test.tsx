import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/messages';
import { createTestConfig, renderShell } from '../../helpers/wallet-harness';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('nav', () => {
  it('W4-E16: has "Dashboard", and marks it as the current page on /dashboard', () => {
    renderShell(createTestConfig());
    const nav = screen.getByRole('navigation', { name: messages.mainNav });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      messages.navAsk,
      messages.navDashboard,
      messages.navVerify,
    ]);
    expect(within(nav).getByRole('link', { name: messages.navDashboard })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: messages.navAsk })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
