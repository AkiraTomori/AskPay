import { REFUND_REASONS } from '@askpay/shared/errors';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { ResultView } from '@/features/ask/components/ResultView';
import { askMessages } from '@/features/ask/messages';
import { messages } from '@/lib/messages';
import {
  DEPOSIT_TX,
  QID,
  QUESTION,
  SETTLE_TX,
  citation,
  errorResponse,
  json,
  paidBody,
  refundedBody,
  resultBody,
  stubApi,
} from '../../helpers/ask-api';
import { connectWithUi, createTestConfig, renderShell } from '../../helpers/wallet-harness';

afterEach(() => vi.useRealTimers());

type Reply = Record<string, unknown> | Response;
const reply = (r: Reply) => (r instanceof Response ? r : json({ data: r }));

// Answers each GET from `queue` in order and repeats the last one.
function renderPage(...queue: Reply[]) {
  const rest = [...queue];
  const api = stubApi({
    post: [],
    get: () => reply(rest.length > 1 ? (rest.shift() as Reply) : (rest[0] as Reply)),
  });
  const view = render(
    <Providers config={createTestConfig()}>
      <ResultView qid={QID} />
    </Providers>,
  );
  return { ...view, api, gets: () => api.calls.filter((c) => c.method === 'GET').length };
}

const snowtrace = (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`;

describe('AP-07-AC01 the result of a paid question', () => {
  it('W3-E01: question, badge, amount, Vietnam time and two Snowtrace links', async () => {
    renderPage(paidBody());
    expect(await screen.findByRole('heading', { level: 1, name: QUESTION })).toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(screen.getByText('0,05 USDC')).toBeInTheDocument();
    expect(screen.getByText('15/11 21:40')).toBeInTheDocument();
    for (const [name, hash] of [
      [new RegExp(`^${askMessages.txDeposit}`), DEPOSIT_TX],
      [new RegExp(`^${askMessages.txPaid}`), SETTLE_TX],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', snowtrace(hash));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
      expect(link).toHaveAttribute('title', hash);
    }
    expect(screen.getByRole('link', { name: askMessages.askAnother })).toHaveAttribute('href', '/');
    expect(document.title).toBe(askMessages.pageTitle(QUESTION));
    // A settled page has one live region (the badge); the timeline's is off (design §2, §7).
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(screen.getByText(askMessages.badgeAnnounce.paid)).toHaveAttribute('aria-live', 'polite');
  });
});

describe('AP-07-AC02 the two-line verification mark', () => {
  it('W3-E02: every mark has both lines, one mark per verified card', async () => {
    renderPage(paidBody({ citations: [citation(), citation({ dieu: 7 }), citation({ dieu: 9 })] }));
    await screen.findByText(askMessages.badge.paid);
    const main = screen.getAllByText(askMessages.verifiedMain);
    const sub = screen.getAllByText(askMessages.verifiedSub);
    expect(main).toHaveLength(3);
    expect(sub).toHaveLength(3);
    // Each card holds the two lines together.
    for (const card of screen.getAllByRole('article')) {
      expect(within(card).getAllByText(askMessages.verifiedMain)).toHaveLength(1);
      expect(within(card).getAllByText(askMessages.verifiedSub)).toHaveLength(1);
    }
  });

  it('W3-E03: verifiedOnChain = false shows no tick, a plain line, and retries after 3 s; a true stops it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const unverified = paidBody({ citations: [citation({ verifiedOnChain: false })] });
    const { gets } = renderPage(unverified, paidBody());
    expect(await screen.findByText(askMessages.notVerified, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.getByText(/Đang thử lại/)).toBeInTheDocument();
    // Plain muted line: not the error colour.
    expect(screen.getByText(askMessages.notVerified, { exact: false })).not.toHaveClass(
      'text-error',
    );
    expect(gets()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(2900));
    expect(gets()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(await screen.findByText(askMessages.verifiedMain)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.notVerified, { exact: false })).not.toBeInTheDocument();
    const after = gets();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(gets()).toBe(after); // the page stopped polling
  });

  it('W3-E03: a card that never matches is read 4 more times (3, 6, 12, 24 s), then left alone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { gets } = renderPage(paidBody({ citations: [citation({ verifiedOnChain: false })] }));
    await screen.findByText(askMessages.badge.paid);
    expect(gets()).toBe(1);
    for (const [wait, total] of [
      [3000, 2],
      [6000, 3],
      [12000, 4],
      [24000, 5],
    ] as const) {
      await act(() => vi.advanceTimersByTimeAsync(wait + 50));
      expect(gets()).toBe(total);
    }
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(gets()).toBe(5);
    // The line stays, without the "retrying" part.
    expect(screen.getByText(askMessages.notVerified)).toBeInTheDocument();
    expect(screen.queryByText(/Đang thử lại/)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
  });
});

describe('AP-07-AC03 nothing is paid or verified before the chain says so', () => {
  it('W3-E04: status PAID without tx.settle is "processing", has no tick, and keeps polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const early = paidBody({ tx: { deposit: DEPOSIT_TX } });
    const { gets } = renderPage(early, paidBody());
    expect(await screen.findByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.paid)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.queryByText(/thời gian thử việc không quá 60 ngày/)).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(gets()).toBeGreaterThan(1);
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(screen.getByText(askMessages.verifiedMain)).toBeInTheDocument();
  });

  it('W3-E05: ANSWERING with an answer already in the data shows a skeleton, not the answer', async () => {
    renderPage(paidBody({ stage: 'ANSWERING', status: 'PENDING', tx: { deposit: DEPOSIT_TX } }));
    expect(await screen.findByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.queryByText(/thời gian thử việc không quá 60 ngày/)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.paid)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.refunded)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.badgeAnnounce.paid)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.badgeAnnounce.refunded)).not.toBeInTheDocument();
  });
});

describe('Q-04 refunded questions', () => {
  const answered = { answer: 'Câu trả lời đã bị hoàn tiền.', citations: [citation()] };

  async function checkFailed(reason: 'CHECKER_REJECTED' | 'INVALID_CITATION') {
    renderPage(refundedBody(reason, answered));
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    const warning = screen.getByText(askMessages.failedCheckWarning);
    const answer = screen.getByText(answered.answer);
    // The warning comes first in the DOM, and the answer points at it.
    expect(warning.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer).toHaveClass('text-ink-muted');
    expect(answer.className).not.toMatch(/opacity/);
    expect(answer.getAttribute('aria-describedby')).toBe(warning.closest('[id]')?.id);
    expect(screen.getByText(REFUND_REASONS[reason])).toBeInTheDocument();
    // Refund-tone card, no tick, no verdict on the card.
    expect(screen.getByRole('article').className).toContain('border-l-refund');
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedSub)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.notVerified)).not.toBeInTheDocument();
    // The badge is not red.
    expect(screen.getByText(askMessages.badge.refunded).className).not.toMatch(/error/);
    expect(
      screen.getByRole('link', { name: new RegExp(`^${askMessages.txRefund}`) }),
    ).toHaveAttribute('href', snowtrace(SETTLE_TX));
  }

  it('W3-E06: CHECKER_REJECTED', () => checkFailed('CHECKER_REJECTED'));
  it('W3-E07: INVALID_CITATION', () => checkFailed('INVALID_CITATION'));

  it('W3-E08: NO_CITATION with noBasis = true has no answer warning, with noBasis = false it does', async () => {
    const first = renderPage(
      refundedBody('NO_CITATION', { answer: 'Không có căn cứ.', noBasis: true }),
    );
    expect(await screen.findByText(askMessages.noBasisTitle)).toBeInTheDocument();
    expect(screen.getByText(REFUND_REASONS.NO_CITATION)).toBeInTheDocument();
    expect(screen.getByText('Không có căn cứ.')).toHaveClass('text-ink-muted');
    expect(screen.queryByText(askMessages.failedCheckWarning)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    first.unmount();

    renderPage(
      refundedBody('NO_CITATION', {
        answer: 'Tôi nghĩ là 60 ngày.',
        noBasis: false,
        citations: [],
      }),
    );
    expect(await screen.findByText(askMessages.noBasisTitle)).toBeInTheDocument();
    expect(screen.getByText(askMessages.failedCheckWarning)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('W3-E09: ANSWER_FAILED says so and offers "Hỏi lại" with the question prefilled (U-14)', async () => {
    renderPage(refundedBody('ANSWER_FAILED', { answer: null }));
    expect(await screen.findByText(askMessages.answerFailed)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: askMessages.answerHeading }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: askMessages.askAgain })).toHaveAttribute(
      'href',
      `/?q=${encodeURIComponent(QUESTION)}`,
    );
    expect(screen.queryByRole('link', { name: askMessages.askAnother })).not.toBeInTheDocument();
  });

  it('W3-E10: TIMEOUT says the money came back and links the claimRefund tx as "Hoàn tiền"', async () => {
    renderPage(refundedBody('TIMEOUT'));
    expect(await screen.findByText(askMessages.timeoutRefunded)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: new RegExp(`^${askMessages.txRefund}`) }),
    ).toHaveAttribute('href', snowtrace(SETTLE_TX));
    expect(screen.queryByRole('link', { name: new RegExp(`^${askMessages.txPaid}`) })).toBeNull();
  });

  it('TIMEOUT with an answer warns "chưa qua kiểm tra" (the checker never ran), not "không đạt"', async () => {
    renderPage(refundedBody('TIMEOUT', { answer: 'Câu trả lời muộn.' }));
    expect(await screen.findByText(askMessages.uncheckedWarning)).toBeInTheDocument();
    expect(askMessages.uncheckedWarning).toContain('chưa qua kiểm tra');
    expect(screen.queryByText(askMessages.failedCheckWarning)).not.toBeInTheDocument();
  });

  it('a refund with no reason says only that the money came back', async () => {
    renderPage(refundedBody(null));
    expect(await screen.findByText(askMessages.refundedGeneric)).toBeInTheDocument();
  });
});

describe('CLAIMABLE', () => {
  it('W3-E11: overdue badge and sentence, the claim button (W5), slow poll; a later PAID replaces the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { gets } = renderPage(
      resultBody({ stage: 'SETTLING', status: 'CLAIMABLE', amount: '50000' }),
      paidBody(),
    );
    expect(await screen.findByText(askMessages.badge.expired)).toBeInTheDocument();
    expect(screen.getByText(askMessages.statusClaimable)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: askMessages.connectToClaim })).toBeInTheDocument();
    expect(gets()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets()).toBe(1); // not every second
    await act(() => vi.advanceTimersByTimeAsync(5200));
    expect(gets()).toBe(2);
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.expired)).not.toBeInTheDocument();
  });

  it('does not poll while the tab is hidden, and the focus refetch restarts the slow poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { gets } = renderPage(resultBody({ stage: 'SETTLING', status: 'CLAIMABLE' }));
    await screen.findByText(askMessages.badge.expired);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(gets()).toBe(1);

    // The tab comes back: react-query refetches on focus, and the 10 s cadence resumes.
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await waitFor(() => expect(gets()).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(gets()).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(gets()).toBe(3);
    visibility.mockRestore();
  });
});

describe('load states', () => {
  it('W3-E12: 404, then a load error with retry, then a stale-data line', async () => {
    const missing = renderPage(errorResponse(404, 'QUESTION_NOT_FOUND'));
    expect(await screen.findByText(askMessages.notFound)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: messages.backToAsk })).toHaveAttribute('href', '/');
    missing.unmount();

    const failed = renderPage(new Response('boom', { status: 500 }), paidBody());
    expect(await screen.findByText(askMessages.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.notFound)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: askMessages.retry }));
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    failed.unmount();
  });

  it('W3-E12: a 500 after data keeps the old data and adds "Mất kết nối, đang thử lại…"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage(
      resultBody({ stage: 'ANSWERING', status: 'PENDING', amount: '50000' }),
      new Response('boom', { status: 502 }),
    );
    expect(await screen.findByText(askMessages.badge.pending)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(await screen.findByText(askMessages.reconnecting)).toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(QUESTION);
    expect(screen.queryByText(askMessages.loadFailed)).not.toBeInTheDocument();
  });
});

describe('polling limits and the freshness line', () => {
  it('W3-E04b: a closed status that never gets its settlement tx stops after 31 reads, says so, and a retry asks again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const closed = paidBody({ tx: { deposit: DEPOSIT_TX } });
    const { gets } = renderPage(closed);
    expect(await screen.findByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.settleStalled)).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(gets()).toBe(31); // the first read and 30 more, then nothing
    expect(screen.getByText(askMessages.settleStalled)).toBeInTheDocument();
    // Still "processing": a stopped page does not call the money paid.
    expect(screen.getByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.paid)).not.toBeInTheDocument();

    await act(async () => {
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByRole('button', { name: askMessages.retry }));
    });
    await waitFor(() => expect(gets()).toBe(32));
    // The allowance starts again: it polls once more after a second.
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(gets()).toBeGreaterThan(32);
  });

  it('W3-E12b: a failed refresh with no read scheduled says the connection is lost, not "retrying", and offers a retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { gets } = renderPage(paidBody(), new Response('boom', { status: 502 }), paidBody());
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets()).toBe(1); // a settled page does not poll

    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    expect(await screen.findByText(askMessages.connectionLost)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.reconnecting)).not.toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.paid)).toBeInTheDocument(); // the data stays

    await act(async () => {
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByRole('button', { name: askMessages.retry }));
    });
    await waitFor(() => expect(screen.queryByText(askMessages.connectionLost)).toBeNull());
    visibility.mockRestore();
  });
});

describe('the tab title', () => {
  it('W3-E01b: is the question while the page is open, and the previous title comes back when it closes', async () => {
    document.title = 'AskPay';
    const { unmount } = renderPage(paidBody());
    await screen.findByText(askMessages.badge.paid);
    // QUESTION is longer than 60 characters: the first 60, an ellipsis, the site name.
    expect(document.title).toBe(`${QUESTION.slice(0, 60)}… · AskPay`);
    unmount();
    expect(document.title).toBe('AskPay');
  });

  it('pageTitle: one line, cut to 60 characters with an ellipsis, never splits a character', () => {
    expect(askMessages.pageTitle('Thử việc\n  tối đa\tbao lâu?')).toBe(
      'Thử việc tối đa bao lâu? · AskPay',
    );
    const long = 'Đ'.repeat(61);
    expect(askMessages.pageTitle(long)).toBe(`${'Đ'.repeat(60)}… · AskPay`);
    expect(askMessages.pageTitle('😀'.repeat(61))).toBe(`${'😀'.repeat(60)}… · AskPay`);
    expect(askMessages.pageTitle('a'.repeat(60))).toBe(`${'a'.repeat(60)} · AskPay`);
    expect(askMessages.pageTitle('   ')).toBe('AskPay');
  });
});

describe('citation cards', () => {
  it('W3-E15: "Xem nguyên văn" opens; the quote is in <mark> and the text keeps its line breaks', async () => {
    renderPage(paidBody());
    const summary = await screen.findByText(askMessages.showFullText);
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const user = userEvent.setup();
    // <summary> opens on Enter/Space natively in a browser; jsdom has no such key handling, so
    // the click is what is simulated here. Being a native <details> is what gives the keyboard.
    await user.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    const mark = details.querySelector('mark') as HTMLElement;
    expect(mark.textContent).toBe('trình độ chuyên môn\nb) Không quá 30 ngày.');
    expect(details.querySelector('p')?.className).toContain('font-serif');
    expect(details.querySelector('p')?.className).toContain('whitespace-pre-line');
    // A screen reader hears that the span is the quoted part.
    expect(mark.previousElementSibling).toHaveTextContent(askMessages.quotedPart);
  });

  it('W3-E15: an empty `text` has no <details>, only the muted line', async () => {
    renderPage(paidBody({ citations: [citation({ text: '' })] }));
    expect(await screen.findByText(askMessages.fullTextMissing)).toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
  });

  it('a Điều that has no Khoản (khoan = 0) drops the "Khoản" part of the title', async () => {
    renderPage(paidBody({ citations: [citation({ khoan: 0 })] }));
    expect(
      await screen.findByRole('heading', { name: 'Điều 25 — Thời gian thử việc' }),
    ).toBeTruthy();
  });

  it('W3-E16: HTML and markdown in the answer, quote and text show as typed', async () => {
    renderPage(
      paidBody({
        answer: 'Câu <b>x</b> và **y**',
        citations: [citation({ quote: '<i>q</i>', text: 'văn bản <i>q</i> **z**' })],
      }),
    );
    expect(await screen.findByText('Câu <b>x</b> và **y**')).toBeInTheDocument();
    expect(screen.getByText('“<i>q</i>”')).toBeInTheDocument();
    expect(document.querySelector('main b, main i, main strong, main em')).toBeNull();
    expect(document.body.innerHTML).not.toContain('<b>x</b>');
  });

  it('W3-E19: cards keep the order of citations[] from the API, not the order of Điều', async () => {
    renderPage(
      paidBody({
        citations: [citation({ dieu: 90 }), citation({ dieu: 5 }), citation({ dieu: 40 })],
      }),
    );
    await screen.findByText(askMessages.badge.paid);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Điều 90 · Khoản 2 — Thời gian thử việc',
      'Điều 5 · Khoản 2 — Thời gian thử việc',
      'Điều 40 · Khoản 2 — Thời gian thử việc',
    ]);
  });
});

describe('disclaimer and wording', () => {
  const answerStates: [string, Reply][] = [
    ['skeleton', resultBody({ stage: 'ANSWERING', status: 'PENDING' })],
    ['paid', paidBody()],
    ['refunded', refundedBody('CHECKER_REJECTED', { answer: 'x', citations: [citation()] })],
  ];

  it.each(answerStates)(
    'W3-E17 AP-07-AC04: %s has the sentence right after the answer, the footer banner, and one landmark',
    async (_name, body) => {
      stubApi({ post: [], get: () => reply(body) });
      renderShell(createTestConfig(), <ResultView qid={QID} />);
      const heading = await screen.findByRole('heading', { name: askMessages.answerHeading });
      const section = heading.closest('section') as HTMLElement;
      // Last element of the answer section, right after the answer.
      expect(section.lastElementChild).toHaveTextContent(messages.disclaimer);
      expect(screen.getAllByText(messages.disclaimer)).toHaveLength(2);
      expect(screen.getAllByRole('complementary', { name: messages.disclaimerLabel })).toHaveLength(
        1,
      );
    },
  );

  it('W3-E18: no string says "Đã xác minh" or "kiểm đúng nguyên văn"', () => {
    const strings = JSON.stringify(askMessages) + JSON.stringify(messages);
    expect(strings).not.toMatch(/đã xác minh/i);
    expect(strings).not.toMatch(/kiểm đúng nguyên văn/i);
  });

  it('W3-E20: the page does not change when the wallet is missing or on the wrong network', async () => {
    stubApi({ post: [], get: () => reply(paidBody()) });
    const { user } = renderShell(createTestConfig({ startChainId: 1 }), <ResultView qid={QID} />);
    await screen.findByText(askMessages.badge.paid);
    const pageText = () => screen.getByRole('main').textContent;
    const before = pageText();
    await connectWithUi(user);
    await screen.findByText(messages.wrongNetwork);
    expect(pageText()).toBe(before);
  });
});
