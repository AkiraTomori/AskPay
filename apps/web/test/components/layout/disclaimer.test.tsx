import { screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DisclaimerBanner } from '@/components/layout/DisclaimerBanner';
import { messages } from '@/lib/messages';
import { connectWithUi, createTestConfig, must, renderShell } from '../../helpers/wallet-harness';

// The banner must be the sentence from the spec, not closable, and independent of wallet state.
function expectDisclaimerOnly() {
  const matches = screen.getAllByText(messages.disclaimer);
  expect(matches).toHaveLength(1);
  const banner = screen.getByRole('complementary', { name: messages.disclaimerLabel });
  expect(banner).toContainElement(must(matches[0]));
  expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
  expect(banner.closest('[aria-hidden="true"]')).toBeNull();
}

describe('DisclaimerBanner', () => {
  it('AP-07-AC04 W1-E01: uses the exact wording', () => {
    expect(messages.disclaimer).toBe('Thông tin tham khảo, không thay thế tư vấn pháp lý.');
    const html = renderToString(<DisclaimerBanner />);
    expect(html).toContain(messages.disclaimer);
    expect(html).toMatch(new RegExp(`<aside[^>]*aria-label="${messages.disclaimerLabel}"`));
  });

  it('AP-07-AC04 W1-E01: is present with no wallet connected', () => {
    renderShell(createTestConfig());
    expectDisclaimerOnly();
  });

  it('AP-07-AC04 W1-E01: is present while connected on Fuji', async () => {
    const { user } = renderShell(createTestConfig());
    await connectWithUi(user);
    await screen.findByText('0,05 USDC');
    expectDisclaimerOnly();
  });

  it('AP-07-AC04 W1-E01: is present on the wrong network, next to the guard', async () => {
    const { user } = renderShell(createTestConfig({ startChainId: 1 }));
    await connectWithUi(user);
    await screen.findByText(messages.wrongNetwork);
    expectDisclaimerOnly();
  });
});
