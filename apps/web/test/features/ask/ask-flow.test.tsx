import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { paymentPayloadSchema, decodeHeader } from '@askpay/shared/x402';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskForm } from '@/features/ask/components/AskForm';
import { askMessages } from '@/features/ask/messages';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  connectWithUi,
  createTestConfig,
  must,
  renderShell,
  routerPush,
  rpcStats,
  signing,
  walletOf,
} from '../../helpers/wallet-harness';
import {
  QID,
  QUESTION,
  errorResponse,
  json,
  quoteBody,
  quoteResponse,
  resultBody,
  stubApi,
} from '../../helpers/ask-api';

type Config = Parameters<typeof createTestConfig>[0];
type Api = Parameters<typeof stubApi>[0];

// Fake timers for the tests that wait on polling or on deadlines; `shouldAdvanceTime` keeps
// wagmi's and react-query's promises moving while the clock is controlled.
const FAKE = { shouldAdvanceTime: true } as const;

async function openAsk({
  config: configOptions,
  api,
  text = QUESTION,
  connect = true,
  fake = false,
}: {
  config?: Config;
  api: Api;
  text?: string;
  connect?: boolean;
  fake?: boolean;
}) {
  if (fake) vi.useFakeTimers(FAKE);
  const config = createTestConfig(configOptions);
  const stub = stubApi(api);
  const rendered = renderShell(config, <AskForm />);
  const user = fake ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) : rendered.user;
  if (connect) await connectWithUi(user);
  const textbox = await screen.findByRole('textbox', { name: askMessages.questionLabel });
  if (text) {
    await user.click(textbox);
    await user.paste(text);
  }
  const clickButton = async (name: string | RegExp) =>
    user.click(await screen.findByRole('button', { name }));
  return { config, stub, user, textbox, clickButton };
}

const priceNotice = () => screen.findByRole('region', { name: askMessages.priceLabel });
const ask = (name = askMessages.ask) => name;
const payName = askMessages.pay('0,05');
const settled = (stage = 'PAID') => json({ data: resultBody({ stage, status: 'PAID' }) });

beforeEach(() => {
  rpcStats.balanceReads = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ask form: price before wallet', () => {
  it('AP-02-AC01 AP-02-AC03 W2-E01: shows the price and the sign button, and has not opened the wallet', async () => {
    const { clickButton } = await openAsk({ api: { post: () => quoteResponse() } });
    await clickButton(ask());
    expect(await priceNotice()).toHaveTextContent('0,05 USDC');
    expect(screen.getByText('≈ 1.300đ (ước tính)')).toBeInTheDocument();
    expect(screen.getByText(askMessages.escrowNote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: payName })).toBeEnabled();
    expect(signing.requests).toHaveLength(0);
  });

  it('AP-02-AC02 W2-E02: blank or 501 characters disable the button without any request', async () => {
    const { stub, user, textbox } = await openAsk({ api: { post: [] }, text: '   ' });
    expect(screen.getByRole('button', { name: ask() })).toBeDisabled();
    await user.clear(textbox);
    await user.click(textbox);
    await user.paste('a'.repeat(501));
    expect(screen.getByRole('button', { name: ask() })).toBeDisabled();
    expect(screen.getByText(askMessages.tooLong)).toBeInTheDocument();
    expect(screen.getByText('501/500')).toBeInTheDocument();
    expect(stub.calls).toHaveLength(0);
  });

  it('AP-03-AC04 W2-E03: quotes and pays with the NFC string, byte for byte the same in both requests', async () => {
    const decomposed = 'Thử việc tối đa bao lâu?'.normalize('NFD');
    const { stub, clickButton } = await openAsk({
      text: decomposed,
      api: { post: [() => quoteResponse(), () => settled()] },
    });
    await clickButton(ask());
    await clickButton(payName);
    await waitFor(() => expect(stub.paymentCalls()).toHaveLength(1));
    const nfc = decomposed.normalize('NFC');
    expect(stub.quoteCalls()[0]?.body).toEqual({ question: nfc });
    expect(stub.paymentCalls()[0]?.body).toEqual({ question: nfc, qid: QID });
  });
});

describe('ask form: signing and sending', () => {
  it('AP-03-AC01 W2-E04: signs, sends PAYMENT-SIGNATURE, goes to the question page and refreshes the balance', async () => {
    // Frozen once: `quoteBody()` defaults to "now + 300 s", so calling it again for the assertion
    // could land in the next second and differ from the quote the server "sent".
    const validBefore = Math.floor(Date.now() / 1000) + 300;
    const { stub, clickButton } = await openAsk({
      api: { post: [() => quoteResponse({ validBefore }), () => settled()] },
    });
    await clickButton(ask());
    await clickButton(payName);
    await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));

    const header = must(stub.paymentCalls()[0]).headers.get('payment-signature');
    const payload = decodeHeader(paymentPayloadSchema, must(header));
    expect(payload?.payload.authorization).toMatchObject({
      from: ACCOUNT_A.toLowerCase(),
      validAfter: '0',
      nonce: QID,
    });
    expect(payload?.payload.authorization.to).toBe(payload?.accepted.payTo);
    expect(payload?.accepted).toEqual(quoteBody({ validBefore }).accepts[0]);
    expect(payload?.payload.authorization.validBefore).toBe(String(validBefore));
    expect(signing.requests).toHaveLength(1);
    expect(must(signing.requests[0]).account.toLowerCase()).toBe(ACCOUNT_A.toLowerCase());
    // 1 read at connect, more after the payment: the balance query was invalidated.
    await waitFor(() => expect(rpcStats.balanceReads).toBeGreaterThan(1));
  });

  it('W2-E05: rejecting the signature goes back to the quote and sends nothing', async () => {
    const { stub, clickButton } = await openAsk({
      config: { signTypedDataError: true },
      api: { post: () => quoteResponse() },
    });
    await clickButton(ask());
    await clickButton(payName);
    expect(await screen.findByText(askMessages.signRejected)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: payName })).toBeEnabled();
    expect(stub.paymentCalls()).toHaveLength(0);
    expect(screen.getByRole('region', { name: askMessages.priceLabel })).toBeInTheDocument();
  });

  it('AP-03-AC05 W2-E06: with too little USDC the button is off and nothing is signed or sent', async () => {
    const { stub, clickButton } = await openAsk({
      config: { balances: { [ACCOUNT_A]: 10_000n } },
      api: { post: () => quoteResponse() },
    });
    await clickButton(ask());
    expect(await screen.findByText(askMessages.insufficient('0,01', '0,05'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(askMessages.getTestUsdc) })).toHaveAttribute(
      'href',
      'https://faucet.circle.com',
    );
    expect(screen.getByRole('button', { name: payName })).toBeDisabled();
    expect(signing.requests).toHaveLength(0);
    expect(stub.paymentCalls()).toHaveLength(0);
  });

  it('AP-03-AC05 W2-E07: when the balance cannot be read, the server answer supplies the shortfall', async () => {
    const details = {
      reason: 'INSUFFICIENT_BALANCE',
      balance: '10000',
      price: '50000',
      faucetUrl: 'https://faucet.circle.com',
    };
    const { clickButton } = await openAsk({
      config: { balanceError: true },
      api: {
        post: [() => quoteResponse(), () => errorResponse(402, 'PAYMENT_INVALID', details)],
      },
    });
    await clickButton(ask());
    await clickButton(payName);
    expect(await screen.findByText(askMessages.insufficient('0,01', '0,05'))).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: new RegExp(askMessages.getTestUsdc) }),
    ).toBeInTheDocument();
  });

  it('AP-03-AC06 W2-E09: a 202 DEPOSITING goes straight to the question page with no new quote', async () => {
    const { stub, clickButton } = await openAsk({
      api: {
        post: [() => quoteResponse(), () => json({ data: { qid: QID, stage: 'DEPOSITING' } }, 202)],
        get: () => json({ data: resultBody({ stage: 'DEPOSITING', status: 'PENDING' }) }),
      },
    });
    await clickButton(ask());
    await clickButton(payName);
    await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));
    expect(stub.quoteCalls()).toHaveLength(1);
  });

  it.each([
    ['with details', { qid: QID, stage: 'PAID' }],
    ['without details', undefined],
  ])(
    'W2-E16: a 409 already settled %s goes to the qid held by the client',
    async (_name, details) => {
      const { clickButton } = await openAsk({
        api: {
          post: [
            () => quoteResponse(),
            () => errorResponse(409, 'QUESTION_ALREADY_SETTLED', details),
          ],
          get: () => json({ data: resultBody() }),
        },
      });
      await clickButton(ask());
      await clickButton(payName);
      await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));
    },
  );
});

describe('ask form: when the answer to the second POST is lost', () => {
  it('AP-03-AC06 W2-E08: a network error means "do not sign again", then the poll moves it on', async () => {
    const states = [
      json({ data: resultBody({ stage: 'DEPOSITING', status: 'PENDING' }) }),
      json({ data: resultBody({ stage: 'ANSWERING', status: 'PENDING' }) }),
    ];
    const { stub, clickButton, textbox } = await openAsk({
      fake: true,
      api: {
        post: [
          () => quoteResponse(),
          () => {
            throw new TypeError('Failed to fetch');
          },
        ],
        get: () =>
          states.shift() ?? json({ data: resultBody({ stage: 'ANSWERING', status: 'PENDING' }) }),
      },
    });
    await clickButton(ask());
    await clickButton(payName);
    expect(await screen.findByText(new RegExp(askMessages.unsure))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.newQuote })).not.toBeInTheDocument();
    expect(textbox).toHaveAttribute('readonly');
    expect(screen.getByRole('link', { name: askMessages.openQuestion })).toHaveAttribute(
      'href',
      `/questions/${QID}`,
    );
    const fetchedQuestion = () => stub.calls.some((call) => call.method === 'GET');
    // The first poll answer is DEPOSITING: the money is not certainly in escrow, so stay here.
    await waitFor(() => expect(fetchedQuestion()).toBe(true));
    expect(routerPush()).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000)); // the next poll sees ANSWERING
    await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));
  });

  it('W2-E10: DEPOSITING then a 503 stays here; "Thử lại" resends the very same header', async () => {
    let answer503: (response: Response) => void = () => {};
    const second = new Promise<Response>((resolve) => {
      answer503 = resolve;
    });
    const { stub, clickButton } = await openAsk({
      fake: true,
      api: {
        post: [() => quoteResponse(), () => second, () => settled()],
        get: () => json({ data: resultBody({ stage: 'DEPOSITING', status: 'PENDING' }) }),
      },
    });
    await clickButton(ask());
    await clickButton(payName);
    await waitFor(() => expect(stub.paymentCalls()).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(1500)); // the poll sees DEPOSITING
    expect(routerPush()).not.toHaveBeenCalled();
    await act(async () => answer503(errorResponse(503, 'CHAIN_UNAVAILABLE')));
    expect(
      await screen.findByText(
        'Hệ thống tạm không nhận câu hỏi. Bạn chưa bị trừ tiền, hãy thử lại sau.',
      ),
    ).toBeInTheDocument();
    expect(routerPush()).not.toHaveBeenCalled();

    await clickButton(askMessages.retry);
    await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));
    const [first, resent] = stub.paymentCalls();
    expect(resent?.headers.get('payment-signature')).toBe(first?.headers.get('payment-signature'));
    expect(signing.requests).toHaveLength(1); // no second signature
    expect(stub.quoteCalls()).toHaveLength(1);
  });

  it('AP-03-AC06 W2-E11: unsure, the poll shows QUOTED and the signature runs out: a new quote is allowed', async () => {
    const { clickButton } = await openAsk({
      fake: true,
      api: {
        post: [
          () => quoteResponse(),
          () => {
            throw new TypeError('Failed to fetch');
          },
        ],
        get: () => json({ data: resultBody({ stage: 'QUOTED' }) }),
      },
    });
    await clickButton(ask());
    await clickButton(payName);
    expect(await screen.findByRole('button', { name: askMessages.resend })).toBeInTheDocument();
    // The quote itself is closed 90 s before validBefore; the signature only at validBefore.
    await act(() => vi.advanceTimersByTimeAsync(220_000));
    expect(screen.queryByRole('button', { name: askMessages.resend })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: askMessages.newQuote })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(await screen.findByText(askMessages.signatureExpired)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: askMessages.newQuote })).toBeEnabled();
  });
});

describe('ask form: the quote is dropped when what it was made for changes', () => {
  it('W2-E12: editing one character drops the quote', async () => {
    const { user, textbox, clickButton } = await openAsk({ api: { post: () => quoteResponse() } });
    await clickButton(ask());
    await screen.findByRole('button', { name: payName });
    await user.type(textbox, 'x');
    expect(screen.queryByRole('region', { name: askMessages.priceLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ask() })).toBeInTheDocument();
  });

  it('W2-E12: changing the account or the network drops the quote', async () => {
    const { config, clickButton } = await openAsk({ api: { post: () => quoteResponse() } });
    await clickButton(ask());
    await screen.findByRole('button', { name: payName });
    act(() => walletOf(config).onAccountsChanged([ACCOUNT_B]));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: askMessages.priceLabel }),
      ).not.toBeInTheDocument(),
    );

    await clickButton(ask());
    await screen.findByRole('button', { name: payName });
    act(() => walletOf(config).onChainChanged('0x1'));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: askMessages.priceLabel }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('button', { name: askMessages.switchToFuji }),
    ).toBeInTheDocument();
  });

  it('W2-E22: an account change while the wallet is open drops the signature unsent', async () => {
    const { config, stub, clickButton, textbox } = await openAsk({
      api: { post: [() => quoteResponse()] },
    });
    await clickButton(ask());
    signing.hold();
    await clickButton(payName);
    await screen.findByRole('button', { name: askMessages.confirmInWallet });
    act(() => walletOf(config).onAccountsChanged([ACCOUNT_B]));
    await act(async () => signing.release());
    expect(await screen.findByRole('button', { name: ask() })).toBeInTheDocument();
    expect(stub.paymentCalls()).toHaveLength(0);
    expect(textbox).toHaveValue(QUESTION);
  });

  it('W2-E13: a quote 300 s from validBefore closes after 210 s, before the wallet opens', async () => {
    const { clickButton } = await openAsk({ fake: true, api: { post: () => quoteResponse() } });
    await clickButton(ask());
    await screen.findByRole('button', { name: payName });
    await act(() => vi.advanceTimersByTimeAsync(209_000));
    expect(screen.getByRole('button', { name: payName })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByRole('button', { name: askMessages.newQuote })).toBeEnabled();
    expect(screen.getByText(askMessages.quoteExpired)).toBeInTheDocument();
    expect(signing.requests).toHaveLength(0);
  });

  it('W2-E14: a quote paying someone other than the published escrow never opens the wallet', async () => {
    const { clickButton } = await openAsk({
      api: { post: () => quoteResponse({ payTo: `0x${'11'.repeat(20)}` }) },
    });
    await clickButton(ask());
    expect(await screen.findByText(askMessages.quoteMismatch)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: payName })).not.toBeInTheDocument();
    expect(signing.requests).toHaveLength(0);
  });
});

describe('ask form: wallet states', () => {
  it('W2-E17: no wallet → "Kết nối ví để hỏi" opens the W1 dialog', async () => {
    const { user } = await openAsk({ connect: false, api: { post: [] }, text: '' });
    await user.click(await screen.findByRole('button', { name: askMessages.connectToAsk }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('W2-E17: wrong network → "Chuyển sang Fuji"', async () => {
    await openAsk({ config: { startChainId: 1 }, api: { post: [] }, text: '' });
    expect(
      await screen.findByRole('button', { name: askMessages.switchToFuji }),
    ).toBeInTheDocument();
  });

  it('W2-E18: Ctrl+Enter asks, focus lands on the sign button, Enter signs', async () => {
    const { user, textbox } = await openAsk({
      api: { post: [() => quoteResponse(), () => settled()] },
    });
    await user.click(textbox);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const sign = await screen.findByRole('button', { name: payName });
    await waitFor(() => expect(sign).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(routerPush()).toHaveBeenCalledWith(`/questions/${QID}`));
  });

  it('a 429 on the first call shows the rate-limit sentence, keeps the question and shows no price', async () => {
    const { clickButton } = await openAsk({
      api: { post: () => errorResponse(429, 'RATE_LIMITED') },
    });
    await clickButton(ask());
    expect(
      await screen.findByText('Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ask() })).toBeEnabled();
  });
});
