import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Providers } from '@/app/providers';
import { AppShell } from '@/components/layout/AppShell';
import { useWalletStatus } from '@/components/wallet/use-wallet-status';
import { messages } from '@/lib/messages';
import {
  ACCOUNT_A,
  createTestConfig,
  renderShell,
  walletButtonName,
} from '../../helpers/wallet-harness';

describe('page reload', () => {
  it('W1-E02: reconnects an authorised wallet without ever showing "Kết nối ví"', async () => {
    const config = createTestConfig({ reloadWithAuthorisedWallet: true });
    const seen: string[] = [];
    function Recorder() {
      seen.push(useWalletStatus().kind);
      return null;
    }
    render(
      <Providers config={config}>
        <Recorder />
        <AppShell>
          <p>nội dung trang</p>
        </AppShell>
      </Providers>,
    );

    await screen.findByRole('button', { name: walletButtonName(ACCOUNT_A) });
    expect(seen).not.toContain('disconnected');
    expect(seen.at(-1)).toBe('ready');
    expect(screen.queryByRole('button', { name: messages.connect })).not.toBeInTheDocument();
  });

  it('a first-time visitor goes from the skeleton straight to "Kết nối ví"', async () => {
    renderShell(createTestConfig());
    expect(await screen.findByRole('button', { name: messages.connect })).toBeInTheDocument();
  });
});
