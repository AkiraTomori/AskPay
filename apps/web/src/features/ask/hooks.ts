'use client';

import type { QuestionResult } from '@askpay/shared/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { useSignTypedData } from 'wagmi';
import { useUsdcBalance } from '@/components/wallet/use-usdc-balance';
import { useWalletStatus } from '@/components/wallet/use-wallet-status';
import { FUJI_CHAIN_ID } from '@/lib/constants';
import { classifyWalletError } from '@/lib/wallet-errors';
import { getQuestion, requestQuote, submitPayment } from './api';
import { HELD_STAGES, type AskState } from './ask-state';
import { deriveButton, deriveNotice } from './ask-view';
import {
  buildAuthorization,
  buildPaymentHeader,
  buildQuote,
  buildTypedData,
  isQuoteExpired,
  quoteMatchesDeployment,
  type SignedPayment,
} from './payment';
import { checkQuestion } from './question';
import { classifySubmit } from './submit-outcome';

// --- Polling a question (shared with the result page, W3) -------------------------------------

class NotFoundError extends Error {}

const FINAL_STATUSES = new Set(['PAID', 'REFUNDED', 'CLAIMABLE']);

export function useQuestionProgress(qid: string | undefined, options: { backoff?: boolean } = {}) {
  const query = useQuery({
    queryKey: ['question', qid],
    enabled: qid !== undefined,
    retry: false,
    // Keep polling in a background tab: the wallet popup can take focus away from this one.
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      const data = q.state.data;
      // The result page stops on a 404; while a payment is unsure a 404 proves nothing, keep going.
      if (!options.backoff && q.state.error instanceof NotFoundError) return false;
      if (data && ((data.status && FINAL_STATUSES.has(data.status)) || data.stage === 'EXPIRED')) {
        return false;
      }
      // T-07: every second; after ~30 answers, every 3 s (used while the outcome is unsure).
      return options.backoff && q.state.dataUpdateCount >= 30 ? 3000 : 1000;
    },
    queryFn: async (): Promise<QuestionResult> => {
      const result = await getQuestion(qid as string);
      if (result.kind === 'data') return result.data;
      if (result.kind === 'error' && result.code === 'QUESTION_NOT_FOUND')
        throw new NotFoundError();
      throw new Error('Could not load the question');
    },
  });
  return {
    question: query.data,
    notFound: query.error instanceof NotFoundError,
    // A failed refresh keeps the last data on screen; `loadFailed` is for the case with none.
    loadFailed: query.isError && !(query.error instanceof NotFoundError),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

// --- Clock helpers ----------------------------------------------------------------------------

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// Milliseconds left until `deadline` (local clock), ticking every second; undefined with no deadline.
export function useCountdown(deadline: number | undefined): number | undefined {
  const now = useNow(deadline !== undefined);
  return deadline === undefined ? undefined : Math.max(0, deadline - now);
}

// --- useAsk -----------------------------------------------------------------------------------

type Active = Extract<AskState, { kind: 'submitting' | 'unsure' }>;

// The whole payment flow (design W2 §3): question -> 402 quote -> sign -> send again -> follow
// the server until the escrow holds the money. Components only read what this returns.
export function useAsk(draft: string) {
  const wallet = useWalletStatus();
  const router = useRouter();
  const queryClient = useQueryClient();
  const balanceKey = useUsdcBalance().queryKey;
  const { mutateAsync: signTypedData } = useSignTypedData();

  const [state, setStateRaw] = useState<AskState>({ kind: 'editing' });
  const stateRef = useRef(state);
  const walletRef = useRef(wallet);
  const draftRef = useRef(draft);
  const balanceKeyRef = useRef(balanceKey);
  // Bumped whenever the flow is abandoned; async steps that started earlier then do nothing.
  const flowRef = useRef(0);
  useEffect(() => {
    walletRef.current = wallet;
    draftRef.current = draft;
    balanceKeyRef.current = balanceKey;
  });

  const setState = useCallback((next: AskState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const refreshBalance = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: balanceKeyRef.current });
  }, [queryClient]);

  const redirect = useCallback(
    (qid: Hex) => {
      setState({ kind: 'redirecting', qid });
      refreshBalance();
      router.push(`/questions/${qid}`);
    },
    [refreshBalance, router, setState],
  );

  // POST #2. Never aborted on unmount: the request runs to the server's answer, and the result
  // page polls on its own. Its answer only matters while this flow is still waiting for it.
  const send = useCallback(
    async (sending: Active) => {
      const flow = flowRef.current;
      const result = await submitPayment({
        question: sending.question,
        qid: sending.payment.qid,
        header: sending.payment.header,
      });
      refreshBalance();
      const current = stateRef.current;
      if (flow !== flowRef.current) return;
      if (current.kind !== 'submitting' && current.kind !== 'unsure') return;

      const outcome = classifySubmit(result);
      switch (outcome.kind) {
        case 'held':
          redirect(current.payment.qid);
          return;
        case 'unsure':
          if (current.kind === 'submitting') setState({ ...current, kind: 'unsure' });
          return;
        case 'quoteGone':
          setState({ kind: 'editing', notice: 'quoteExpired' });
          return;
        case 'failed':
          setState({ kind: 'failed', question: current.question, error: outcome.error });
          return;
        case 'insufficient':
          setState({
            kind: 'quoted',
            question: current.question,
            quote: current.quote,
            notice: { kind: 'insufficient', balance: outcome.balance, price: outcome.price },
          });
          return;
        case 'busy':
          setState({
            kind: 'quoted',
            question: current.question,
            quote: current.quote,
            payment: current.payment,
            notice: { kind: outcome.reason },
          });
          return;
      }
    },
    [redirect, refreshBalance, setState],
  );

  const ask = useCallback(() => {
    const current = stateRef.current;
    if (current.kind !== 'editing' && current.kind !== 'failed') return;
    if (walletRef.current.kind !== 'ready') return;
    const check = checkQuestion(draftRef.current);
    if (!check.ok) return;

    const flow = (flowRef.current += 1);
    setState({ kind: 'quoting', question: check.question });
    void requestQuote(check.question).then((result) => {
      if (flow !== flowRef.current || stateRef.current.kind !== 'quoting') return;
      const failed = (error: Extract<AskState, { kind: 'failed' }>['error']) =>
        setState({ kind: 'failed', question: check.question, error });
      if (result.kind === 'paymentRequired') {
        const requirement = result.body.accepts[0];
        if (!requirement) return failed({ kind: 'network' });
        // Never open the wallet for a payee this repo does not publish.
        if (!quoteMatchesDeployment(requirement)) return failed({ kind: 'quoteMismatch' });
        const quote = buildQuote(requirement, Date.now(), result.headers.get('date'));
        return setState({ kind: 'quoted', question: check.question, quote });
      }
      if (result.kind === 'error') return failed({ kind: 'api', code: result.code });
      return failed({ kind: 'network' });
    });
  }, [setState]);

  const pay = useCallback(async () => {
    const current = stateRef.current;
    const from = walletRef.current;
    if (current.kind !== 'quoted' || current.payment || from.kind !== 'ready') return;
    const { quote, question } = current;
    if (isQuoteExpired(quote, Date.now())) {
      setState({ kind: 'editing', notice: 'quoteExpired' });
      return;
    }
    if (from.usdc !== undefined && from.usdc < BigInt(quote.requirement.amount)) return;

    const flow = flowRef.current;
    setState({ kind: 'signing', question, quote });
    // `from` is the account at the moment of the click, not whoever the wallet reports later.
    const authorization = buildAuthorization(quote.requirement, from.address);
    let signature: Hex;
    try {
      signature = await signTypedData({
        account: from.address,
        ...buildTypedData(quote.requirement, authorization),
      });
    } catch (error) {
      if (flow !== flowRef.current) return;
      const kind = classifyWalletError(error);
      setState({
        kind: 'quoted',
        question,
        quote,
        notice: {
          kind:
            kind === 'rejected'
              ? 'signRejected'
              : kind === 'pending'
                ? 'walletPending'
                : 'signFailed',
        },
      });
      return;
    }
    // The account or network changed while the wallet was open: drop the signature unsent.
    if (flow !== flowRef.current) return;
    if (isQuoteExpired(quote, Date.now())) {
      setState({ kind: 'editing', notice: 'expiredWhileSigning' });
      return;
    }
    const payment: SignedPayment = {
      qid: quote.requirement.extra.qid as Hex,
      header: buildPaymentHeader(quote.requirement, authorization, signature),
    };
    const sending: Active = { kind: 'submitting', question, quote, payment };
    setState(sending);
    void send(sending);
  }, [send, setState, signTypedData]);

  // Sends the exact same signed header again. Safe because nonce = qid: the contract takes one
  // deposit per qid and the server lets one request win the stage (AP-03-AC03).
  const retrySend = useCallback(() => {
    const current = stateRef.current;
    if (current.kind !== 'quoted' && current.kind !== 'unsure') return;
    if (current.kind === 'unsure' && current.stage !== 'QUOTED') return;
    const { question, quote, payment } = current;
    if (!payment || isQuoteExpired(quote, Date.now())) return;
    const sending: Active = { kind: 'submitting', question, quote, payment };
    setState(sending);
    void send(sending);
  }, [send, setState]);

  // Editing the question (or any other way of dropping the quote) goes back to a clean form.
  // Locked states ignore it: a signature that may be with the chain is never discarded here.
  const reset = useCallback(() => {
    const current = stateRef.current;
    const droppable =
      current.kind === 'quoting' ||
      current.kind === 'quoted' ||
      current.kind === 'failed' ||
      (current.kind === 'editing' && current.notice !== undefined);
    if (!droppable) return;
    flowRef.current += 1;
    setState({ kind: 'editing' });
  }, [setState]);

  // Follow the server after the signature is sent.
  const polling =
    state.kind === 'submitting' || state.kind === 'unsure' ? state.payment.qid : undefined;
  const { question: polled } = useQuestionProgress(polling, { backoff: true });
  useEffect(() => {
    const current = stateRef.current;
    if (!polled || (current.kind !== 'submitting' && current.kind !== 'unsure')) return;
    if (polled.qid !== current.payment.qid) return;
    // Navigate only when the money is certainly in escrow. DEPOSITING is not enough (design §6.2).
    // `status` is PENDING from DEPOSITING onwards (A6), so only a closed status counts here.
    if (
      HELD_STAGES.has(polled.stage) ||
      (polled.status !== undefined && polled.status !== 'PENDING')
    ) {
      redirect(current.payment.qid);
      return;
    }
    if (polled.stage !== current.stage) setState({ ...current, stage: polled.stage });
  }, [polled, redirect, setState]);

  // The wallet account or network changed (design W1 §3.5): a quote or an unsent signature made
  // for the old one is dropped. Once the signature is with the server (submitting, unsure) nothing
  // is cancelled: it is already out of the wallet's hands.
  const walletKey =
    wallet.kind === 'ready'
      ? `${wallet.address}:${FUJI_CHAIN_ID}`
      : wallet.kind === 'wrongNetwork'
        ? `${wallet.address}:${wallet.chainId}`
        : wallet.kind;
  const previousWalletKey = useRef(walletKey);
  useEffect(() => {
    if (previousWalletKey.current === walletKey) return;
    previousWalletKey.current = walletKey;
    const current = stateRef.current;
    if (current.kind === 'quoting' || current.kind === 'quoted' || current.kind === 'signing') {
      flowRef.current += 1;
      setState({ kind: 'editing' });
    }
  }, [walletKey, setState]);

  // Deadlines (design §6.3, §6.5), measured on the local clock from the quote's arrival.
  useEffect(() => {
    if (state.kind === 'quoted') {
      const id = setTimeout(
        () => {
          if (stateRef.current === state) setState({ kind: 'editing', notice: 'quoteExpired' });
        },
        Math.max(0, state.quote.expiresAt - Date.now()),
      );
      return () => clearTimeout(id);
    }
    // Unsure and the server shows no deposit: once validBefore has passed the signature can never
    // be used, so no money can leave and a new quote is safe.
    if (state.kind === 'unsure' && (state.stage === 'QUOTED' || state.stage === 'EXPIRED')) {
      const id = setTimeout(
        () => {
          if (stateRef.current !== state) return;
          setState({
            kind: 'failed',
            question: state.question,
            error: { kind: 'signatureExpired' },
          });
        },
        Math.max(0, state.quote.validBeforeAt - Date.now()),
      );
      return () => clearTimeout(id);
    }
  }, [state, setState]);

  const now = useNow(state.kind === 'unsure');
  const check = useMemo(() => checkQuestion(draft), [draft]);
  const locked = ['signing', 'submitting', 'unsure', 'redirecting'].includes(state.kind);

  return {
    state,
    check,
    locked,
    button: deriveButton(wallet, state, check, now),
    notice: deriveNotice(wallet, state),
    ask,
    pay,
    retrySend,
    reset,
  };
}
