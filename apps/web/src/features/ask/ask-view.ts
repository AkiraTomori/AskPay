import { ERROR_CODES } from '@askpay/shared/errors';
import { formatUsdcVi } from '@/lib/format';
import { messages } from '@/lib/messages';
import { errorNeedsNewQuote, type AskError, type AskState } from './ask-state';
import { askMessages } from './messages';
import { isQuoteExpired, type Quote } from './payment';
import type { QuestionCheck } from './question';
import type { WalletStatus } from '@/components/wallet/use-wallet-status';

// What the form shows for a given state: pure, so the table in design W2 §3.2 is testable
// without rendering. Components do not reason about the state themselves.

export type ButtonAction = 'ask' | 'pay' | 'retrySend' | 'connect' | 'switchChain' | 'none';
export type ButtonView =
  | { kind: 'skeleton' }
  | { kind: 'button'; label: string; disabled: boolean; loading: boolean; action: ButtonAction };

export type NoticeView = {
  tone: 'error' | 'muted';
  text: string;
  faucet?: boolean; // add the "get test USDC" link
  questionHref?: string; // add the "open the question page" link
};

const amountOf = (quote: Quote) => BigInt(quote.requirement.amount);

const button = (
  label: string,
  action: ButtonAction,
  opts: { disabled?: boolean; loading?: boolean } = {},
): ButtonView => ({
  kind: 'button',
  label,
  action,
  disabled: opts.disabled ?? false,
  loading: opts.loading ?? false,
});

function lacksUsdc(wallet: WalletStatus, quote: Quote): bigint | undefined {
  if (wallet.kind !== 'ready' || wallet.usdc === undefined) return undefined;
  return wallet.usdc < amountOf(quote) ? wallet.usdc : undefined;
}

// Unsure + the server still shows QUOTED + the quote is still good: nothing was held, so the
// exact same signature can be sent again.
export function canResend(state: AskState, now: number): boolean {
  return state.kind === 'unsure' && state.stage === 'QUOTED' && !isQuoteExpired(state.quote, now);
}

export function deriveButton(
  wallet: WalletStatus,
  state: AskState,
  check: QuestionCheck,
  now: number,
): ButtonView {
  // A payment in flight outranks the wallet: the signature is already with the server.
  switch (state.kind) {
    case 'signing':
      return button(askMessages.confirmInWallet, 'none', { disabled: true, loading: true });
    case 'submitting':
      return button(askMessages.sending, 'none', { disabled: true, loading: true });
    case 'unsure':
      return canResend(state, now)
        ? button(askMessages.resend, 'retrySend')
        : button(askMessages.checking, 'none', { disabled: true, loading: true });
    case 'redirecting':
      return button(askMessages.opening, 'none', { disabled: true, loading: true });
    default:
  }
  if (wallet.kind === 'loading') return { kind: 'skeleton' };
  if (wallet.kind === 'disconnected') return button(askMessages.connectToAsk, 'connect');
  if (wallet.kind === 'connecting')
    return button(askMessages.connecting, 'none', { disabled: true });
  if (wallet.kind === 'wrongNetwork') return button(askMessages.switchToFuji, 'switchChain');

  switch (state.kind) {
    case 'quoting':
      return button(askMessages.quoting, 'none', { disabled: true, loading: true });
    case 'quoted':
      if (state.payment) return button(askMessages.retry, 'retrySend');
      return button(askMessages.pay(formatUsdcVi(amountOf(state.quote))), 'pay', {
        disabled: lacksUsdc(wallet, state.quote) !== undefined,
      });
    case 'failed':
      return button(
        errorNeedsNewQuote(state.error) ? askMessages.newQuote : askMessages.ask,
        'ask',
        { disabled: !check.ok },
      );
    default:
      return button(
        state.kind === 'editing' && state.notice ? askMessages.newQuote : askMessages.ask,
        'ask',
        {
          disabled: !check.ok,
        },
      );
  }
}

function errorText(error: AskError): string {
  switch (error.kind) {
    case 'api':
      return ERROR_CODES[error.code].message;
    case 'network':
      return askMessages.networkError;
    case 'quoteMismatch':
      return askMessages.quoteMismatch;
    case 'signatureExpired':
      return askMessages.signatureExpired;
  }
}

export function deriveNotice(wallet: WalletStatus, state: AskState): NoticeView | null {
  switch (state.kind) {
    case 'editing':
      if (state.notice === 'quoteExpired') return { tone: 'muted', text: askMessages.quoteExpired };
      if (state.notice === 'expiredWhileSigning')
        return { tone: 'muted', text: askMessages.expiredWhileSigning };
      return null;
    case 'failed':
      return { tone: 'error', text: errorText(state.error) };
    case 'signing':
      return {
        tone: 'muted',
        text: askMessages.signHint(formatUsdcVi(amountOf(state.quote))),
      };
    case 'unsure':
      return {
        tone: 'muted',
        text: askMessages.unsure,
        questionHref: `/questions/${state.payment.qid}`,
      };
    case 'quoted': {
      const balance = lacksUsdc(wallet, state.quote);
      if (balance !== undefined) {
        return {
          tone: 'error',
          text: askMessages.insufficient(
            formatUsdcVi(balance),
            formatUsdcVi(amountOf(state.quote)),
          ),
          faucet: true,
        };
      }
      const { notice } = state;
      if (!notice) return null;
      switch (notice.kind) {
        case 'signRejected':
          return { tone: 'muted', text: askMessages.signRejected };
        case 'signFailed':
          return { tone: 'error', text: askMessages.signFailed };
        case 'walletPending':
          return { tone: 'error', text: messages.requestPending };
        case 'chainBusy':
          return { tone: 'error', text: askMessages.chainBusy };
        case 'rateLimited':
          return { tone: 'error', text: ERROR_CODES.RATE_LIMITED.message };
        case 'insufficient':
          return {
            tone: 'error',
            text: askMessages.insufficient(
              formatUsdcVi(notice.balance),
              formatUsdcVi(notice.price),
            ),
            faucet: true,
          };
      }
    }
    default:
      return null;
  }
}
