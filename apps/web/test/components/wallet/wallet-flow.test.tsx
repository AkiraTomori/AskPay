import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { messages } from '@/lib/messages';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  connectWithUi,
  createTestConfig,
  renderShell,
  walletButtonName,
  walletOf,
} from '../../helpers/wallet-harness';

describe('connect wallet', () => {
  it('W1-E02: shows the short address and the USDC balance after connecting', async () => {
    const { user } = renderShell(createTestConfig());
    await connectWithUi(user);

    const button = await screen.findByRole('button', { name: walletButtonName(ACCOUNT_A) });
    expect(await within(button).findByText('0,05 USDC')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus returns to the (new) account button.
    expect(button).toHaveFocus();
  });

  it('W1-E03: a rejected connect keeps the dialog open with a neutral message', async () => {
    const { user } = renderShell(createTestConfig({ connectError: true }));
    await connectWithUi(user);

    const dialog = screen.getByRole('dialog');
    const note = await within(dialog).findByText(messages.connectRejected);
    expect(note).not.toHaveClass('text-error');
    expect(dialog.querySelector('.text-error')).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Mock Connector/ })).toBeEnabled();
  });

  it('W1-E03: another connect failure is shown as an error and can be retried', async () => {
    const { user } = renderShell(createTestConfig({ connectError: new Error('boom') }));
    await connectWithUi(user);

    const note = await within(screen.getByRole('dialog')).findByText(messages.connectFailed);
    expect(note).toHaveClass('text-error');
  });

  it('while the wallet is waiting, other wallets are disabled and Huỷ closes the dialog', async () => {
    const config = createTestConfig();
    // A wallet that never answers: the request stays pending.
    walletOf(config).connect = () => new Promise(() => {});
    const { user } = renderShell(config);
    await user.click(await screen.findByRole('button', { name: messages.connect }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Mock Connector/ }));

    expect(await within(dialog).findByText(messages.openWallet)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Mock Connector/ })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: messages.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('W1-E04: without any wallet the dialog links to Core and MetaMask', async () => {
    const { injected } = await import('wagmi/connectors');
    const { createConfig, http } = await import('wagmi');
    const { avalancheFuji } = await import('wagmi/chains');
    const config = createConfig({
      chains: [avalancheFuji],
      connectors: [injected()],
      transports: { [avalancheFuji.id]: http('http://localhost:0') },
    });
    const { user } = renderShell(config);
    await user.click(await screen.findByRole('button', { name: messages.connect }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(messages.noWallet)).toBeInTheDocument();
    for (const name of [messages.installCore, messages.installMetaMask]) {
      const link = within(dialog).getByRole('link', { name: new RegExp(name) });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
    }
  });
});

describe('wrong network', () => {
  it('W1-E05: shows NetworkGuard and hides the balance; switching removes it and focuses the account button', async () => {
    const { user } = renderShell(createTestConfig({ startChainId: 1 }));
    await connectWithUi(user);

    const accountButton = await screen.findByRole('button', { name: walletButtonName(ACCOUNT_A) });
    expect(screen.getByText(messages.wrongNetwork)).toBeInTheDocument();
    expect(screen.getByText(messages.wrongNetworkChip)).toBeInTheDocument();
    expect(within(accountButton).queryByText(/USDC/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: messages.switchToFuji }));

    await waitFor(() => expect(screen.queryByText(messages.wrongNetwork)).not.toBeInTheDocument());
    expect(screen.getByText(messages.fujiChip)).toBeInTheDocument();
    expect(await within(accountButton).findByText('0,05 USDC')).toBeInTheDocument();
    expect(accountButton).toHaveFocus();
  });

  it('W1-E06: a rejected switch keeps the bar and says so', async () => {
    const { user } = renderShell(createTestConfig({ startChainId: 1, switchChainError: true }));
    await connectWithUi(user);
    await user.click(await screen.findByRole('button', { name: messages.switchToFuji }));

    expect(await screen.findByText(messages.switchRejected)).toBeInTheDocument();
    expect(screen.getByText(messages.wrongNetwork)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.switchToFuji })).toBeEnabled();
  });

  it('explains how to switch by hand when the wallet refuses the request', async () => {
    const { user } = renderShell(
      createTestConfig({ startChainId: 1, switchChainError: new Error('not supported') }),
    );
    await connectWithUi(user);
    await user.click(await screen.findByRole('button', { name: messages.switchToFuji }));

    expect(await screen.findByText(messages.switchUnsupported)).toBeInTheDocument();
  });

  it('does not show the guard before a wallet is connected', async () => {
    renderShell(createTestConfig({ startChainId: 1 }));
    await screen.findByRole('button', { name: messages.connect });
    expect(screen.queryByText(messages.wrongNetwork)).not.toBeInTheDocument();
  });

  it('W1-E05: works with the production config, which knows only Fuji', async () => {
    const config = createTestConfig({ fujiOnly: true });
    const { user } = renderShell(config);
    await connectWithUi(user);
    const accountButton = await screen.findByRole('button', { name: walletButtonName(ACCOUNT_A) });
    await within(accountButton).findByText('0,05 USDC');

    act(() => walletOf(config).onChainChanged('0x1'));
    expect(await screen.findByText(messages.wrongNetwork)).toBeInTheDocument();
    expect(screen.getByText(messages.wrongNetworkChip)).toBeInTheDocument();
    expect(within(accountButton).queryByText(/USDC/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: messages.switchToFuji }));
    await waitFor(() => expect(screen.queryByText(messages.wrongNetwork)).not.toBeInTheDocument());
    expect(accountButton).toHaveFocus();
  });

  it('follows a network change made inside the wallet', async () => {
    const config = createTestConfig();
    const { user } = renderShell(config);
    await connectWithUi(user);
    await screen.findByText(messages.fujiChip);

    act(() => walletOf(config).onChainChanged('0x1'));
    expect(await screen.findByText(messages.wrongNetwork)).toBeInTheDocument();

    act(() => walletOf(config).onChainChanged('0xa869'));
    await waitFor(() => expect(screen.queryByText(messages.wrongNetwork)).not.toBeInTheDocument());
  });
});

describe('wallet side changes', () => {
  it('W1-E07: switching account in the wallet updates the address and the balance', async () => {
    const config = createTestConfig();
    const { user } = renderShell(config);
    await connectWithUi(user);
    await screen.findByText('0,05 USDC');

    act(() => walletOf(config).onAccountsChanged([ACCOUNT_B]));

    const button = await screen.findByRole('button', { name: walletButtonName(ACCOUNT_B) });
    expect(await within(button).findByText('12,5 USDC')).toBeInTheDocument();
  });

  it('goes back to disconnected when the wallet disconnects', async () => {
    const config = createTestConfig();
    const { user } = renderShell(config);
    await connectWithUi(user);
    await screen.findByText('0,05 USDC');

    await act(() => walletOf(config).onDisconnect());
    expect(await screen.findByRole('button', { name: messages.connect })).toBeInTheDocument();
  });
});
