import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { QuestionProgressView } from '@/features/ask/components/QuestionProgressView';
import { askMessages } from '@/features/ask/messages';
import { QID, QUESTION, errorResponse, json, resultBody, stubApi } from '../../helpers/ask-api';
import { createTestConfig } from '../../helpers/wallet-harness';

afterEach(() => vi.useRealTimers());

function renderPage(get: () => Response | Promise<Response>) {
  stubApi({ post: [], get });
  return render(
    <Providers config={createTestConfig()}>
      <QuestionProgressView qid={QID} />
    </Providers>,
  );
}

const stepTexts = () => screen.getAllByRole('listitem').map((item) => item.textContent ?? '');

describe('/questions/[qid] (minimal, W2)', () => {
  it('W2-E21: a question that holds no money says so, and never says "Đã thanh toán"', async () => {
    renderPage(() => json({ data: resultBody({ stage: 'QUOTED' }) }));
    expect(await screen.findByText(askMessages.notHeldPage)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang Hỏi' })).toHaveAttribute('href', '/');
    expect(screen.queryByText(askMessages.statusPaid)).not.toBeInTheDocument();
  });

  it('shows the same message for EXPIRED', async () => {
    renderPage(() => json({ data: resultBody({ stage: 'EXPIRED' }) }));
    expect(await screen.findByText(askMessages.notHeldPage)).toBeInTheDocument();
  });

  it('says not found for a 404, and a load error with a retry for anything else', async () => {
    const first = renderPage(() => errorResponse(404, 'QUESTION_NOT_FOUND'));
    expect(await screen.findByText(askMessages.notFound)).toBeInTheDocument();
    first.unmount();

    let answers = [
      new Response('<html>down</html>', { status: 502 }),
      json({ data: resultBody({ stage: 'ANSWERING' }) }),
    ];
    renderPage(() => answers.shift() ?? json({ data: resultBody({ stage: 'ANSWERING' }) }));
    expect(await screen.findByText(askMessages.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.notFound)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: askMessages.retry }));
    expect(await screen.findByText(askMessages.statusPending)).toBeInTheDocument();
    answers = [];
  });

  it('AP-07-AC03 W2-E15: follows ANSWERING → CHECKING → SETTLING → PAID; the wording comes from status only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queue = [
      resultBody({ stage: 'ANSWERING', status: 'PENDING' }),
      resultBody({ stage: 'CHECKING', status: 'PENDING' }),
      resultBody({ stage: 'SETTLING', status: 'PENDING' }),
      // The stage says PAID but there is no event yet: still not "paid" on screen.
      resultBody({ stage: 'PAID', status: 'PENDING' }),
      resultBody({ stage: 'PAID', status: 'PAID', tx: { settle: `0x${'ab'.repeat(32)}` } }),
    ];
    renderPage(() =>
      json({
        data:
          queue.shift() ??
          resultBody({ stage: 'PAID', status: 'PAID', tx: { settle: `0x${'ab'.repeat(32)}` } }),
      }),
    );
    const next = () => act(() => vi.advanceTimersByTimeAsync(1000));

    await screen.findByText(QUESTION);
    expect(stepTexts()).toEqual([
      expect.stringContaining('Giữ tiền (xong)'),
      expect.stringContaining('Trả lời (đang chạy)'),
      expect.stringContaining('Kiểm tra (chưa tới)'),
      expect.stringContaining('Chốt (chưa tới)'),
    ]);
    await next();
    await waitFor(() => expect(stepTexts()[2]).toContain('Kiểm tra (đang chạy)'));
    await next();
    await waitFor(() => expect(stepTexts()[3]).toContain('Chốt (đang chạy)'));
    await next();
    await waitFor(() => expect(stepTexts()[3]).toContain('Chốt (đang chạy)'));
    expect(screen.queryByText(askMessages.statusPaid)).not.toBeInTheDocument();
    await next();
    await waitFor(() => expect(stepTexts()[3]).toContain('Chốt (xong)'));
    expect(screen.getByText(askMessages.statusPaid)).toBeInTheDocument();
    expect(screen.queryByText(/đã xác minh/i)).not.toBeInTheDocument();
  });

  it('a refunded question shows skipped steps, not ticks, and the refunded wording', async () => {
    renderPage(() =>
      json({
        data: resultBody({
          stage: 'REFUNDED',
          status: 'REFUNDED',
          reason: 'ANSWER_FAILED',
          tx: { settle: `0x${'ab'.repeat(32)}` },
        }),
      }),
    );
    expect(await screen.findByText(askMessages.statusRefunded)).toBeInTheDocument();
    expect(stepTexts()[1]).toContain('bỏ qua');
    expect(stepTexts()[2]).toContain('bỏ qua');
  });

  it('CLAIMABLE: says it is overdue, with no refund button yet (W5)', async () => {
    renderPage(() => json({ data: resultBody({ stage: 'SETTLING', status: 'CLAIMABLE' }) }));
    expect(await screen.findByText(askMessages.statusClaimable)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
