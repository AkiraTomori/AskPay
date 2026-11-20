import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/messages';
import { createTestConfig, renderShell } from '../../helpers/wallet-harness';

vi.mock('next/navigation', () => ({
  usePathname: () => '/verify',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('nav', () => {
  it('W5-E19: has "Xác minh", and marks it as the current page on /verify only', () => {
    renderShell(createTestConfig());
    const nav = screen.getByRole('navigation', { name: messages.mainNav });
    const verify = within(nav).getByRole('link', { name: messages.navVerify });
    expect(verify).toHaveAttribute('href', '/verify');
    expect(verify).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: messages.navAsk })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(nav).getByRole('link', { name: messages.navDashboard })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
