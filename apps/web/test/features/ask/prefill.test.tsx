import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AskForm } from '@/features/ask/components/AskForm';
import { askMessages } from '@/features/ask/messages';
import { QUESTION } from '../../helpers/ask-api';
import { createTestConfig, renderShell } from '../../helpers/wallet-harness';

// The query string and the router's replace spy, as this file's mocked next/navigation shows them.
const mocked = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: mocked.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocked.query),
}));

beforeEach(() => mocked.replace.mockClear());

describe('W3 U-14: "Hỏi lại" prefills the question from ?q=', () => {
  it('puts q in the box once and removes it from the address bar', async () => {
    mocked.query = `q=${encodeURIComponent(QUESTION)}`;
    renderShell(createTestConfig(), <AskForm />);
    const box = await screen.findByRole('textbox', { name: askMessages.questionLabel });
    expect(box).toHaveValue(QUESTION);
    await waitFor(() => expect(mocked.replace).toHaveBeenCalledWith('/'));
  });

  it('with no q the box is empty and the address bar is left alone', async () => {
    mocked.query = '';
    renderShell(createTestConfig(), <AskForm />);
    const box = await screen.findByRole('textbox', { name: askMessages.questionLabel });
    expect(box).toHaveValue('');
    expect(mocked.replace).not.toHaveBeenCalled();
  });
});
