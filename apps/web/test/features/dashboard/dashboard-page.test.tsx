import { fujiDeployment } from '@askpay/shared/abi';
import { ERROR_CODES, REFUND_REASONS } from '@askpay/shared/errors';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { DashboardView } from '@/features/dashboard/components/DashboardView';
import { dashboardMessages as m } from '@/features/dashboard/messages';
import { SETTLE_TX, errorResponse } from '../../helpers/ask-api';
import {
  EVAL,
  listReply,
  qid,
  rowBody,
  rows,
  statsReply,
  stubDashboardApi,
} from '../../helpers/dashboard-api';
import { createTestConfig } from '../../helpers/wallet-harness';

afterEach(() => vi.useRealTimers());

type Handlers = Parameters<typeof stubDashboardApi>[0];

function renderDashboard(handlers: Handlers) {
  const api = stubDashboardApi({
    stats: () => statsReply(),
    questions: () => listReply(rows(1, 3)),
    ...handlers,
  });
  render(
    <Providers config={createTestConfig()}>
      <DashboardView />
    </Providers>,
  );
  return {
    api,
    user: userEvent.setup({
      advanceTimers: (ms) => {
        if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
      },
    }),
  };
}

const tile = (label: string) => {
  const term = screen.getByText(label, { selector: 'dt' });
  return within(term.closest('dl') as HTMLElement);
};

describe('AP-08-AC01 the numbers', () => {
  it('W4-E01: four tiles, each readable as a label–value pair', async () => {
    renderDashboard({});
    await screen.findByText('42');
    expect(tile(m.tiles.questions).getByText('42').tagName).toBe('DD');
    expect(tile(m.tiles.paid).getByText('31').tagName).toBe('DD');
    expect(tile(m.tiles.refunded).getByText('11')).toBeInTheDocument();
    expect(tile(m.tiles.refunded).getByText('26,2% tỉ lệ hoàn tiền')).toBeInTheDocument();
    // "USDC" is a smaller span inside the same <dd>: the pair still reads "1,55 USDC".
    expect(tile(m.tiles.revenue).getByText('USDC').closest('dd')).toHaveTextContent('1,55 USDC');
    expect(tile(m.tiles.revenue).getByText(/^≈ .+đ \(ước tính\)$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: m.title })).toBeInTheDocument();
  });

  it('W4-E03: nothing settled -> "chưa có câu đã chốt", no "0%", and the no-refunds line', async () => {
    renderDashboard({
      stats: () =>
        statsReply({
          paid: 0,
          refunded: 0,
          refundRate: 0,
          refundsByReason: {
            NO_CITATION: 0,
            INVALID_CITATION: 0,
            CHECKER_REJECTED: 0,
            ANSWER_FAILED: 0,
            TIMEOUT: 0,
          },
        }),
    });
    expect(await screen.findByText(m.noSettledYet)).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(screen.getByText(m.noRefunds)).toBeInTheDocument();
  });

  it('W4-E02 AP-08-AC02: says the numbers come from on-chain events, up to a block, and links the contract', async () => {
    renderDashboard({});
    expect(await screen.findByText(m.provenance('38.123.456'))).toBeInTheDocument();
    const link = screen.getByRole('link', { name: new RegExp(fujiDeployment.address.slice(0, 6)) });
    expect(link).toHaveAttribute(
      'href',
      `https://testnet.snowtrace.io/address/${fujiDeployment.address}`,
    );
  });

  it('says so when the indexer has not read a block, and still shows the tiles', async () => {
    renderDashboard({ stats: () => statsReply({ lastIndexedBlock: 0, questions: 0 }) });
    expect(await screen.findByText(m.noEventsYet)).toBeInTheDocument();
    expect(screen.getByText(m.tiles.questions, { selector: 'dt' })).toBeInTheDocument();
  });

  it('W4-E05: reasons are listed with name and count, the full sentence in the title', async () => {
    renderDashboard({});
    const items = (await screen.findAllByRole('listitem')).map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toEqual([
      'Không có trích dẫn: 6 câu',
      'Checker từ chối: 3 câu',
      'Trích dẫn sai luật đã đăng ký: 1 câu',
      'Quá hạn: 1 câu',
      'Lỗi khi trả lời: 0 câu',
    ]);
    const first = screen.getAllByRole('listitem')[0];
    expect(first).toHaveAttribute('title', REFUND_REASONS.NO_CITATION);
  });

  it('W4-E06 AP-09-AC03: no eval -> no heading, not even a "not available" line', async () => {
    renderDashboard({});
    await screen.findByText('42');
    expect(screen.queryByText(m.evalTitle)).not.toBeInTheDocument();
  });

  it('W4-E06: with an eval, shows the three numbers, the date and the commit link', async () => {
    renderDashboard({ stats: () => statsReply({ eval: EVAL }) });
    expect(await screen.findByRole('heading', { name: m.evalTitle })).toBeInTheDocument();
    for (const value of ['82%', '78%', '90%']) expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.getByText(m.evalRun('18/11/2026'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abc1234/ })).toHaveAttribute(
      'href',
      'https://github.com/AkiraTomori/AskPay/commit/abc1234',
    );
  });
});

describe('the table of recent questions', () => {
  it('W4-E07 AP-08-AC01: question link, Snowtrace link, and "—" without a tx', async () => {
    renderDashboard({
      questions: () => listReply([rowBody(1), rowBody(2, { status: 'PENDING', tx: {} })]),
    });
    const table = await screen.findByRole('table', { name: m.recentTitle });
    expect(within(table).getByRole('link', { name: 'Câu hỏi số 1' })).toHaveAttribute(
      'href',
      `/questions/${qid(1)}`,
    );
    expect(
      within(table).getByRole('link', { name: new RegExp(`^${SETTLE_TX.slice(0, 6)}`) }),
    ).toHaveAttribute('href', `https://testnet.snowtrace.io/tx/${SETTLE_TX}`);
    expect(within(table).getAllByRole('link', { name: /^0x/ })).toHaveLength(1);
    expect(within(table).getByText(m.noTx)).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([m.columns.time, m.columns.question, m.columns.status, m.columns.tx]);
  });

  it('W4-E08 AP-07-AC03: PAID without a settle tx is pending, CLAIMABLE is expired, REFUNDED with tx is refunded', async () => {
    renderDashboard({
      questions: () =>
        listReply([
          rowBody(1, { status: 'PAID', tx: {} }),
          rowBody(2, { status: 'CLAIMABLE', tx: {} }),
          rowBody(3, { status: 'REFUNDED', reason: 'TIMEOUT' }),
          rowBody(4),
        ]),
    });
    await screen.findByRole('table');
    expect(screen.getByText('ĐANG XỬ LÝ')).toBeInTheDocument();
    expect(screen.getByText('QUÁ HẠN')).toBeInTheDocument();
    expect(screen.getByText('ĐÃ HOÀN TIỀN')).toBeInTheDocument();
    expect(screen.getByText('ĐÃ THANH TOÁN')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Đã xác minh');
  });

  it('W4-E09: clicking a row opens the question; clicking the tx link does not navigate', async () => {
    const { user } = renderDashboard({});
    const table = await screen.findByRole('table');
    const push = useRouter().push as ReturnType<typeof vi.fn>;
    await user.click(within(table).getAllByRole('time')[0] as HTMLElement);
    expect(push).toHaveBeenCalledWith(`/questions/${qid(1)}`);
    push.mockClear();
    const tx = within(table).getAllByRole('link', { name: /^0x/ })[0] as HTMLElement;
    tx.addEventListener('click', (event) => event.preventDefault()); // jsdom cannot open tabs
    await user.click(tx);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps two Tab stops per row: the question and the tx', async () => {
    renderDashboard({ questions: () => listReply([rowBody(1)]) });
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('link')).toHaveLength(2);
    expect(table.querySelectorAll('tbody tr a[href^="/questions/"]')).toHaveLength(1);
  });
});

describe('"Xem thêm"', () => {
  const pages = (cursor: string | undefined) =>
    cursor === undefined ? listReply(rows(1, 20), 'c1') : listReply(rows(21, 20));

  it('W4-E10: loads the next 20, moves focus to row 21, announces it, and the button goes away', async () => {
    const { api, user } = renderDashboard({ questions: pages });
    const button = await screen.findByRole('button', { name: m.loadMore });
    await user.click(button);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(41)); // 40 + header
    expect(api.urls.some((url) => url.includes('cursor=c1'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Câu hỏi số 21' })).toHaveFocus();
    expect(await screen.findByText(m.loadedMore(20))).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button', { name: m.loadMore })).not.toBeInTheDocument();
  });

  it('W4-E10: no nextCursor on the first page -> no button; a repeated qid shows once', async () => {
    renderDashboard({ questions: () => listReply(rows(1, 3)) });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: m.loadMore })).not.toBeInTheDocument();
  });

  it('W4-E10: a row that is on both pages is shown once', async () => {
    const { user } = renderDashboard({
      questions: (cursor) =>
        cursor === undefined ? listReply(rows(1, 3), 'c1') : listReply(rows(3, 3)),
    });
    await user.click(await screen.findByRole('button', { name: m.loadMore }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6)); // 5 rows + header
    expect(screen.getAllByRole('link', { name: 'Câu hỏi số 3' })).toHaveLength(1);
  });

  it('keeps the rows a refresh pushes off page 1, so 2 new questions do not hide 2 old ones', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let refreshed = false;
    const { user } = renderDashboard({
      questions: (cursor) => {
        if (cursor !== undefined) return listReply(rows(23, 20)); // 23..42
        // Page 1 is 3..22 at first; after the refresh two newer questions (1, 2) are on top.
        return refreshed
          ? listReply([...rows(1, 2), ...rows(3, 18)], 'c2')
          : listReply(rows(3, 20), 'c1');
      },
    });
    await user.click(await screen.findByRole('button', { name: m.loadMore }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(41)); // 40 + header
    refreshed = true;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(43)); // 42 + header
    const questions = screen
      .getAllByRole('link', { name: /^Câu hỏi số/ })
      .map((a) => Number(a.textContent?.replace('Câu hỏi số ', '')));
    expect(questions).toEqual(Array.from({ length: 42 }, (_, i) => i + 1)); // none lost, in order
  });

  it('announces a second load of the same size too (the live region is cleared first)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderDashboard({
      questions: (cursor) => {
        if (cursor === undefined) return listReply(rows(1, 2), 'c1');
        return cursor === 'c1' ? listReply(rows(3, 2), 'c2') : listReply(rows(5, 2));
      },
    });
    await user.click(await screen.findByRole('button', { name: m.loadMore }));
    expect(await screen.findByText(m.loadedMore(2))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: m.loadMore }));
    // Between the two announcements the region is empty: that change is what a screen reader hears.
    await waitFor(() => expect(screen.queryByText(m.loadedMore(2))).not.toBeInTheDocument());
    expect(await screen.findByText(m.loadedMore(2))).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(7);
  });

  it('W4-E11: a failed load keeps the rows, says so, and can be retried', async () => {
    let fail = true;
    const { user } = renderDashboard({
      questions: (cursor) => {
        if (cursor === undefined) return listReply(rows(1, 3), 'c1');
        return fail ? errorResponse(500, 'INTERNAL') : listReply(rows(4, 2));
      },
    });
    await user.click(await screen.findByRole('button', { name: m.loadMore }));
    expect(await screen.findByText(m.loadMoreFailed)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
    fail = false;
    await user.click(screen.getByRole('button', { name: m.loadMore }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6));
    expect(screen.queryByText(m.loadMoreFailed)).not.toBeInTheDocument();
  });
});

describe('empty and failed states', () => {
  it('W4-E12: no questions at all -> "Chưa có câu hỏi nào." and a link to ask', async () => {
    renderDashboard({
      stats: () => statsReply({ questions: 0 }),
      questions: () => listReply([]),
    });
    expect(await screen.findByText(m.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: m.askFirst })).toHaveAttribute('href', '/');
  });

  it('W4-E12: counted on-chain but nothing to list -> the other sentence', async () => {
    renderDashboard({
      stats: () => statsReply({ questions: 3 }),
      questions: () => listReply([]),
    });
    expect(await screen.findByText(m.emptyButCounted)).toBeInTheDocument();
    expect(screen.queryByText(m.empty)).not.toBeInTheDocument();
  });

  it('W4-E13: /stats failing hides the numbers (no zeros) but the table still shows', async () => {
    renderDashboard({ stats: () => errorResponse(500, 'INTERNAL') });
    expect(await screen.findByText(m.statsFailed)).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(m.tiles.questions, { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.retry })).toBeInTheDocument();
  });

  it('W4-E13: /questions failing shows its own error, the numbers still show; retry works', async () => {
    let fail = true;
    const { user } = renderDashboard({
      questions: () => (fail ? errorResponse(500, 'INTERNAL') : listReply(rows(1, 2))),
    });
    expect(await screen.findByText(m.listFailed)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText(m.empty)).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('W4-E13: 429 uses the shared RATE_LIMITED sentence, with a retry button', async () => {
    renderDashboard({ stats: () => errorResponse(429, 'RATE_LIMITED') });
    expect(await screen.findByText(ERROR_CODES.RATE_LIMITED.message)).toBeInTheDocument();
    expect(screen.queryByText(m.statsFailed)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.retry })).toBeInTheDocument();
  });

  it('shows skeletons first, with one status for screen readers', () => {
    stubDashboardApi({
      stats: () => new Promise<never>(() => {}),
      questions: () => new Promise<never>(() => {}),
    });
    render(
      <Providers config={createTestConfig()}>
        <DashboardView />
      </Providers>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('refresh (U-17)', () => {
  it('W4-E14: a failed refresh keeps the old numbers with a note; the next one updates in place', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let call = 0;
    const { api } = renderDashboard({
      stats: () => {
        call += 1;
        if (call === 2) return errorResponse(500, 'INTERNAL');
        return statsReply({ questions: call === 1 ? 42 : 43 });
      },
    });
    await screen.findByText('42');
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByText(m.reconnecting)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText(m.statsFailed)).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByText('43')).toBeInTheDocument();
    expect(screen.queryByText(m.reconnecting)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(api.count('/api/stats')).toBe(3);
  });

  it('re-reads only page 1 of the table; a loaded page 2 is not asked for again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, user } = renderDashboard({
      questions: (cursor) =>
        cursor === undefined ? listReply(rows(1, 2), 'c1') : listReply(rows(3, 2)),
    });
    await user.click(await screen.findByRole('button', { name: m.loadMore }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(api.urls.filter((url) => url.includes('cursor=c1'))).toHaveLength(1);
    expect(
      api.urls.filter((url) => url.startsWith('/api/questions') && !url.includes('cursor')),
    ).toHaveLength(2);
  });
});

describe('no wallet needed', () => {
  it('W4-E15: shows everything without a wallet and offers no connection in the page', async () => {
    renderDashboard({});
    await screen.findByText('42');
    expect(screen.queryByRole('button', { name: /Kết nối ví/ })).not.toBeInTheDocument();
  });
});
