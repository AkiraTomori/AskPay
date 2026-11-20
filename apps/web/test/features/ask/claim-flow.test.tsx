// W5 part A: claim the refund from the wallet, and the result page read from the chain when the
// API is silent (design w5-refund-verify §2, §3, §4). The wallet is wagmi's mock; the chain is the
// fake RPC of the harness (`chainFixture`).
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UserRejectedRequestError,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { ResultView } from '@/features/ask/components/ResultView';
import { askMessages } from '@/features/ask/messages';
import { shortAddress } from '@/lib/format';
import { AVAX_FAUCET_URL } from '@/lib/constants';
import { REFUND_REASONS } from '@askpay/shared/errors';
import { QID, errorResponse, json, paidBody, resultBody, stubApi } from '../../helpers/ask-api';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  BLOCK_TIME,
  chainFixture,
  connectWithUi,
  createTestConfig,
  renderShell,
  resetChain,
  rpcStats,
} from '../../helpers/wallet-harness';

beforeEach(resetChain);
afterEach(() => vi.useRealTimers());

const ESCROW = fujiDeployment.address;
const DEADLINE = BLOCK_TIME - 30; // the latest block is already past it
const claimableBody = (over: Record<string, unknown> = {}) =>
  resultBody({
    stage: 'SETTLING',
    status: 'CLAIMABLE',
    amount: '50000',
    payer: ACCOUNT_A.toLowerCase(),
    ...over,
  });

const refundedLog = (reason = 5, payer: Address = ACCOUNT_A) => ({
  address: ESCROW as `0x${string}`,
  topics: encodeEventTopics({
    abi: askPayEscrowAbi,
    eventName: 'Refunded',
    args: { qid: QID, payer },
  }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint8' }], [50_000n, reason]),
});

const openQuestion = (
  over: Partial<(typeof chainFixture)['questions'] extends Map<string, infer V> ? V : never> = {},
) =>
  chainFixture.questions.set(QID, {
    payer: ACCOUNT_A,
    amount: 50_000n,
    deadline: DEADLINE,
    status: 'Open',
    ...over,
  });

type Reply = Record<string, unknown> | Response | 'network';

function renderPage(reply: Reply, options: Parameters<typeof createTestConfig>[0] = {}) {
  const config = createTestConfig(options);
  const api = stubApi({
    post: [],
    get: () => {
      if (reply === 'network') throw new TypeError('fetch failed');
      return reply instanceof Response ? reply : json({ data: reply });
    },
  });
  const view = renderShell(config, <ResultView qid={QID} />);
  return { ...view, api, config };
}

const claimButton = () => screen.findByRole('button', { name: askMessages.claimButton });

describe('AP-06-AC03 the claim panel on a CLAIMABLE question', () => {
  it('W5-E01: connected as the payer, it says the money comes back to their wallet', async () => {
    openQuestion();
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    expect(await claimButton()).toBeEnabled();
    expect(screen.getByText(askMessages.claimTitle('0,05'))).toBeInTheDocument();
    expect(screen.getByText(askMessages.claimToSelf(shortAddress(ACCOUNT_A)))).toBeInTheDocument();
    expect(screen.getByText(askMessages.claimGasNote)).toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.expired)).toBeInTheDocument();
  });

  it('W5-E02: another wallet is told where the money goes; no wallet and the wrong network have their own button', async () => {
    openQuestion({ payer: ACCOUNT_B });
    const { user } = renderPage(claimableBody({ payer: ACCOUNT_B.toLowerCase() }));
    // Not connected: the button opens the connect dialog of W1.
    await user.click(await screen.findByRole('button', { name: askMessages.connectToClaim }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Mock Connector/ }),
    );
    expect(await claimButton()).toBeEnabled();
    expect(screen.getByText(askMessages.claimToPayer(shortAddress(ACCOUNT_B)))).toBeInTheDocument();
  });

  it('W5-E02: on the wrong network the button says "Chuyển sang Fuji"', async () => {
    openQuestion();
    const { user } = renderPage(claimableBody(), { startChainId: 1 });
    await connectWithUi(user);
    const panel = await screen.findByText(askMessages.statusClaimable);
    expect(
      await within(panel.parentElement as HTMLElement).findByRole('button', {
        name: askMessages.switchToFuji,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
  });
});

describe('AP-06-AC01 claiming', () => {
  it('W5-E03: simulate, one claimRefund tx, then the receipt proves it: ĐÃ HOÀN TIỀN with the tx link', async () => {
    openQuestion();
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    const balanceReadsBefore = rpcStats.balanceReads;
    chainFixture.receipts.set(chainFixture.sendHash, { status: 'success', logs: [refundedLog()] });

    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.timeoutRefunded)).toBeInTheDocument();
    // Exactly one tx, to the escrow, calling claimRefund(qid).
    expect(chainFixture.sent).toHaveLength(1);
    expect(chainFixture.sent[0]).toMatchObject({
      from: ACCOUNT_A,
      to: ESCROW,
      data: encodeFunctionData({ abi: askPayEscrowAbi, functionName: 'claimRefund', args: [QID] }),
    });
    const link = screen.getByRole('link', { name: new RegExp(`^${askMessages.txRefund}`) });
    expect(link).toHaveAttribute(
      'href',
      `https://testnet.snowtrace.io/tx/${chainFixture.sendHash}`,
    );
    // The claim button is gone: nothing invites a second tx. The USDC balance was read again.
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
    await waitFor(() => expect(rpcStats.balanceReads).toBeGreaterThan(balanceReadsBefore));
    // Focus moves to the notice so a keyboard or screen-reader user lands on the result.
    expect(document.activeElement).toBe(document.getElementById('result-notice'));
    expect(REFUND_REASONS.TIMEOUT).toContain('Quá thời hạn');
  });

  it('W5-E03: the API takes over once it says REFUNDED itself (same hash)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openQuestion();
    let body: Record<string, unknown> = claimableBody();
    const config = createTestConfig();
    const api = stubApi({ post: [], get: () => json({ data: body }) });
    const { user } = renderShell(config, <ResultView qid={QID} />);
    await connectWithUi(user);
    chainFixture.receipts.set(chainFixture.sendHash, { status: 'success', logs: [refundedLog()] });
    await user.click(await claimButton());
    await screen.findByText(askMessages.badge.refunded);

    const before = api.calls.filter((call) => call.method === 'GET').length;
    // After the claim the API is read every 3 s (not 10 s).
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(api.calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(before);

    body = resultBody({
      stage: 'REFUNDED',
      status: 'REFUNDED',
      reason: 'TIMEOUT',
      amount: '50000',
      payer: ACCOUNT_A.toLowerCase(),
      tx: { deposit: `0x${'d1'.repeat(32)}`, settle: chainFixture.sendHash },
    });
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.timeoutRefunded)).toBeInTheDocument();
  });
});

describe('AP-06-AC02 claim refused or late', () => {
  it('W5-E04: QuestionNotOpen in the simulation: no wallet prompt, no error colour, the final state', async () => {
    openQuestion();
    chainFixture.simulate = 'QuestionNotOpen';
    const { user, container } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.claimAlreadyClosed)).toBeInTheDocument();
    expect(chainFixture.sent).toHaveLength(0);
    expect(container.querySelector('.text-error')).toBeNull();
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
  });

  it('W5-E05: a tx that reverted after sending is not an error either; it says the tx was not needed', async () => {
    openQuestion();
    const { user, container } = renderPage(claimableBody());
    await connectWithUi(user);
    chainFixture.receipts.set(chainFixture.sendHash, { status: 'reverted', logs: [] });
    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.claimTxNotNeeded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.claimAlreadyClosed)).toBeInTheDocument();
    expect(chainFixture.sent).toHaveLength(1);
    expect(container.querySelector('.text-error')).toBeNull();
  });

  it('W5-E06: DeadlineNotReached: no wallet prompt; the button comes back when a block passes the deadline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The API already says CLAIMABLE, but the chain's clock is 20 s short of the deadline (skew).
    openQuestion({ deadline: BLOCK_TIME + 20 });
    chainFixture.simulate = 'DeadlineNotReached';
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.claimNotYet(21))).toBeInTheDocument();
    expect(chainFixture.sent).toHaveLength(0);
    expect(screen.getByRole('button', { name: askMessages.claimButton })).toBeDisabled();

    chainFixture.simulate = undefined;
    chainFixture.blockTime = BLOCK_TIME + 25;
    await act(() => vi.advanceTimersByTimeAsync(3500));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: askMessages.claimButton })).toBeEnabled(),
    );
    expect(screen.queryByText(/^Blockchain chưa tới hạn/)).not.toBeInTheDocument();
  });

  it('W5-E07: rejecting the signature goes back to idle, calmly', async () => {
    openQuestion();
    chainFixture.sendError = new UserRejectedRequestError(new Error('rejected'));
    const { user, container } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.claimRejected)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: askMessages.claimButton })).toBeEnabled();
    expect(container.querySelector('.text-error')).toBeNull();
  });

  it('W5-E07: no AVAX for gas: says so and links the faucet', async () => {
    openQuestion();
    chainFixture.sendError = new Error('insufficient funds for gas * price + value');
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());

    expect(await screen.findByText(new RegExp(askMessages.claimNoGas))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(askMessages.getTestAvax) })).toHaveAttribute(
      'href',
      AVAX_FAUCET_URL,
    );
  });

  it('a node that cannot be asked: says so, and the button works again', async () => {
    openQuestion();
    chainFixture.simulate = 'rpc';
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());
    expect(await screen.findByText(askMessages.claimRpcFailed)).toBeInTheDocument();
    expect(chainFixture.sent).toHaveLength(0);
    expect(screen.getByRole('button', { name: askMessages.claimButton })).toBeEnabled();
  });

  it('W5-E08: no receipt after 60 s: still pending, a Snowtrace hint, and no way to send another tx', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openQuestion();
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    await user.click(await claimButton());
    expect(await screen.findByText(askMessages.claimPending)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.claimSlow)).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(await screen.findByText(askMessages.claimSlow)).toBeInTheDocument();
    expect(screen.getByText(askMessages.claimPending)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
    expect(chainFixture.sent).toHaveLength(1);

    // The receipt arrives later: it is read again every few seconds and proves the refund.
    chainFixture.receipts.set(chainFixture.sendHash, { status: 'success', logs: [refundedLog()] });
    await act(() => vi.advanceTimersByTimeAsync(5500));
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
  });

  it('W5-E09 (in the page): a receipt whose Refunded log is for another reason is not accepted as proof', async () => {
    openQuestion();
    const { user } = renderPage(claimableBody());
    await connectWithUi(user);
    chainFixture.receipts.set(chainFixture.sendHash, {
      status: 'success',
      logs: [refundedLog(4)],
    });
    await user.click(await claimButton());
    expect(await screen.findByText(askMessages.claimFailed)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.refunded)).not.toBeInTheDocument();
  });
});

describe('AP-06-AC03 claiming for someone else', () => {
  it('a wallet that is not the asker is told the money went to the asker, not to "you"', async () => {
    openQuestion({ payer: ACCOUNT_B });
    const { user } = renderPage(claimableBody({ payer: ACCOUNT_B.toLowerCase() }));
    await connectWithUi(user); // the mock wallet is ACCOUNT_A
    chainFixture.receipts.set(chainFixture.sendHash, {
      status: 'success',
      logs: [refundedLog(5, ACCOUNT_B)],
    });
    await user.click(await claimButton());

    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(
      screen.getByText(askMessages.timeoutRefundedToPayer(shortAddress(ACCOUNT_B))),
    ).toBeInTheDocument();
    expect(screen.queryByText(askMessages.timeoutRefunded)).not.toBeInTheDocument();
  });
});

describe('P5 the API closed the question but has no settlement tx, and it is long overdue', () => {
  const late = () => Date.now() - 11 * 60_000;

  it("REFUNDED without a tx + chain Refunded: the chain's answer is shown, not a spinner", async () => {
    openQuestion({ status: 'Refunded' });
    renderPage(
      resultBody({ stage: 'REFUNDED', status: 'REFUNDED', amount: '50000', createdAt: late() }),
    );
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.chainRefunded)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.pending)).not.toBeInTheDocument();
  });

  it('PAID without a tx + chain Paid: no tick and no answer; the page is not made to look settled', async () => {
    openQuestion({ status: 'Paid' });
    renderPage(paidBody({ tx: { deposit: `0x${'d1'.repeat(32)}` }, createdAt: late() }));
    await waitFor(() => expect(chainFixture.reads.questions).toBeGreaterThan(0));
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.paid)).not.toBeInTheDocument();
  });

  it('the same answer a minute after the question is not read from the chain', async () => {
    openQuestion({ status: 'Refunded' });
    renderPage(
      resultBody({
        stage: 'REFUNDED',
        status: 'REFUNDED',
        amount: '50000',
        createdAt: Date.now() - 60_000,
      }),
    );
    await screen.findByText(askMessages.badge.pending);
    expect(chainFixture.reads.questions).toBe(0);
  });
});

describe('P5 the page when the API is down: read straight from the chain', () => {
  it('W5-E10: network error + Open past its deadline: the chain block, QUÁ HẠN, and the claim button', async () => {
    openQuestion();
    const { user } = renderPage('network');
    await connectWithUi(user);

    expect(await claimButton()).toBeEnabled();
    expect(
      screen.getByRole('heading', { level: 1, name: /^Câu hỏi 0x9f9f…9f9f$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: askMessages.chainSourceTitle })).toBeInTheDocument();
    expect(screen.getByText(askMessages.badge.expired)).toBeInTheDocument();
    // The escrow address next to it, so the reader sees the numbers do not come from AskPay.
    const source = screen.getByRole('heading', {
      name: askMessages.chainSourceTitle,
    }).parentElement;
    expect(
      within(source as HTMLElement).getByRole('link', { name: new RegExp(shortAddress(ESCROW)) }),
    ).toHaveAttribute('href', `https://testnet.snowtrace.io/address/${ESCROW}`);
    // Said once, politely: the deadline has been reached.
    expect(screen.getByText(askMessages.deadlineReached)).toHaveAttribute('aria-live', 'polite');
  });

  it('W5-E11: 404 + nothing on chain: the usual "not found", no chain block', async () => {
    const { findByText } = renderPage(errorResponse(404, 'QUESTION_NOT_FOUND'));
    expect(await findByText(askMessages.notFound)).toBeInTheDocument();
    await waitFor(() => expect(chainFixture.reads.questions).toBeGreaterThan(0));
    expect(screen.queryByText(askMessages.chainSourceTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
  });

  it('W5-E11: 404 + Paid on chain: ĐÃ THANH TOÁN, no tick and no card (the server is needed for those)', async () => {
    openQuestion({ status: 'Paid' });
    renderPage(errorResponse(404, 'QUESTION_NOT_FOUND'));
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(screen.getByText(askMessages.chainPaidNoContent)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.verifiedMain)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('chain Refunded: says the money went back, without a reason (the struct has none)', async () => {
    openQuestion({ status: 'Refunded' });
    renderPage(errorResponse(404, 'QUESTION_NOT_FOUND'));
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.chainRefunded)).toBeInTheDocument();
  });

  it('the chain cannot be read either: says so and offers a retry', async () => {
    chainFixture.readsFail = true;
    renderPage('network');
    // One retry after 0.5 s before the page gives up.
    expect(
      await screen.findByText(askMessages.chainFailed, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: askMessages.retry })).toBeInTheDocument();
  });

  it('W5-E12: API says PENDING 11 minutes after the question; the chain says Open and late: the button shows', async () => {
    openQuestion();
    renderPage(
      resultBody({
        stage: 'ANSWERING',
        status: 'PENDING',
        amount: '50000',
        createdAt: Date.now() - 11 * 60_000,
      }),
    );
    expect(await screen.findByText(askMessages.badge.expired)).toBeInTheDocument();
    expect(await screen.findByText(askMessages.statusClaimable)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: askMessages.connectToClaim })).toBeInTheDocument();
  });

  it('a PENDING question that is not late is not read from the chain at all', async () => {
    openQuestion();
    renderPage(
      resultBody({ stage: 'ANSWERING', status: 'PENDING', createdAt: Date.now() - 60_000 }),
    );
    await screen.findByText(askMessages.badge.pending);
    expect(chainFixture.reads.questions).toBe(0);
  });

  it('chain wins: the API says CLAIMABLE, the chain says Refunded', async () => {
    openQuestion({ status: 'Refunded' });
    renderPage(claimableBody());
    expect(await screen.findByText(askMessages.badge.refunded)).toBeInTheDocument();
    expect(screen.getByText(askMessages.chainRefunded)).toBeInTheDocument();
    expect(screen.queryByText(askMessages.badge.expired)).not.toBeInTheDocument();
  });

  it('W5-E13: Open and not yet due: the deadline in Vietnam time and a countdown that is not a live region', async () => {
    chainFixture.questions.set(QID, {
      payer: ACCOUNT_A,
      amount: 50_000n,
      deadline: BLOCK_TIME + 300,
      status: 'Open',
    });
    renderPage('network');
    // The block is at 14:00 UTC, so the deadline (+5 min) is 21:05 in Vietnam.
    expect(await screen.findByText(askMessages.chainOpenNotYet('21:05'))).toBeInTheDocument();
    const countdown = screen.getByText(/^Còn \d\d:\d\d$/);
    expect(countdown.closest('[aria-live]')).toBeNull();
    expect(screen.getByText(askMessages.badge.pending)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.claimButton })).not.toBeInTheDocument();
  });

  it('an API that answers PAID is never overridden by the chain read', async () => {
    openQuestion({ status: 'Refunded' });
    renderPage(paidBody());
    expect(await screen.findByText(askMessages.badge.paid)).toBeInTheDocument();
    expect(chainFixture.reads.questions).toBe(0);
    expect(screen.queryByText(askMessages.chainRefunded)).not.toBeInTheDocument();
  });
});
