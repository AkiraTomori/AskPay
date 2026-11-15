import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAUCET_URL } from '@/lib/constants';
import { messages } from '@/lib/messages';
import {
  ACCOUNT_A,
  connectWithUi,
  createTestConfig,
  renderShell,
  walletButtonName,
} from '../../helpers/wallet-harness';

async function openMenu() {
  const config = createTestConfig();
  const { user } = renderShell(config);
  await connectWithUi(user);
  const trigger = await screen.findByRole('button', { name: walletButtonName(ACCOUNT_A) });
  await screen.findByText('0,05 USDC');
  await user.click(trigger);
  return { user, trigger, menu: screen.getByRole('menu') };
}

describe('AccountMenu', () => {
  it('shows the full address, the balance and the four actions', async () => {
    const { trigger, menu } = await openMenu();

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Address and balance sit beside the menu, not inside it: the menu owns only menuitems.
    expect(screen.getByText(ACCOUNT_A)).toBeInTheDocument();
    expect(screen.getByText(/Số dư: 0,05 USDC/)).toBeInTheDocument();
    expect(within(menu).queryByText(ACCOUNT_A)).not.toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      messages.copyAddress,
      `${messages.viewOnSnowtrace}${messages.opensInNewTab}`,
      `${messages.getTestUsdc}${messages.opensInNewTab}`,
      messages.disconnect,
    ]);
    expect(within(menu).getByRole('menuitem', { name: /Snowtrace/ })).toHaveAttribute(
      'href',
      `https://testnet.snowtrace.io/address/${ACCOUNT_A}`,
    );
    expect(within(menu).getByRole('menuitem', { name: /USDC testnet/ })).toHaveAttribute(
      'href',
      FAUCET_URL,
    );
  });

  it('W1-E08: arrows move focus, Esc closes and returns focus to the button', async () => {
    const { user, trigger, menu } = await openMenu();
    const items = within(menu).getAllByRole('menuitem');

    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[3]).toHaveFocus(); // wraps around
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when Tab moves focus out, and on a click outside', async () => {
    const { user } = await openMenu();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: walletButtonName(ACCOUNT_A) }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByText('nội dung trang'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('copies the address, says so for 2 seconds, then restores the label', async () => {
    const { user, menu } = await openMenu();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await user.click(within(menu).getByRole('menuitem', { name: messages.copyAddress }));
      expect(write).toHaveBeenCalledWith(ACCOUNT_A);
      expect(await within(menu).findByText(messages.copied)).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => expect(within(menu).getByText(messages.copyAddress)).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnects from the menu', async () => {
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: messages.disconnect }));
    expect(await screen.findByRole('button', { name: messages.connect })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Focus lands on the new button instead of falling back to <body>.
    expect(screen.getByRole('button', { name: messages.connect })).toHaveFocus();
  });
});
