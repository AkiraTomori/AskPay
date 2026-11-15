import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { messages } from '@/lib/messages';
import { createTestConfig, must, renderShell } from '../../helpers/wallet-harness';

describe('app shell', () => {
  it('W1-E08: the first Tab stop is the skip link, and it targets main', async () => {
    const { user } = renderShell(createTestConfig());
    await user.tab();
    const skip = screen.getByRole('link', { name: messages.skipToContent });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).toBe(screen.getByRole('main'));
  });

  it('orders the regions: header, main, disclaimer, footer', () => {
    renderShell(createTestConfig());
    const header = screen.getByRole('banner');
    const main = screen.getByRole('main');
    const disclaimer = screen.getByText(messages.disclaimer);
    const footer = screen.getByRole('contentinfo');
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(header, main)).toBe(true);
    expect(before(main, disclaimer)).toBe(true);
    expect(before(disclaimer, footer)).toBe(true);
  });

  it('marks the current page in the nav: "Hỏi" is current on /', () => {
    renderShell(createTestConfig());
    const nav = screen.getByRole('navigation', { name: messages.mainNav });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([messages.navAsk, messages.navDashboard]);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
  });

  it('links the footer contract address to Snowtrace with the full address in the title', () => {
    renderShell(createTestConfig());
    const link = within(screen.getByRole('contentinfo')).getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/testnet\.snowtrace\.io\/address\/0x869e/),
    );
    expect(link).toHaveAttribute('title', '0x869e95576f6dd6f06118cf733b4f307ae37ddce0');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('mobile nav', () => {
  it('opens and closes with the button; Esc closes and returns focus to it', async () => {
    const { user } = renderShell(createTestConfig());
    const button = screen.getByRole('button', { name: messages.menu });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    const open = screen.getByRole('button', { name: messages.closeMenu });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('aria-controls', expect.any(String));
    expect(document.getElementById(must(open.getAttribute('aria-controls')))).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: messages.closeMenu })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.menu })).toHaveFocus();
  });

  it('keeps the wallet button outside the menu', async () => {
    renderShell(createTestConfig());
    const menuButton = screen.getByRole('button', { name: messages.menu });
    const connect = await screen.findByRole('button', { name: messages.connect });
    expect(must(menuButton.parentElement).contains(connect)).toBe(false);
  });
});
