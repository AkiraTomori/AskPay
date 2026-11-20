'use client';

import type { QuestionResult } from '@askpay/shared/api';
import { askPayEscrowAbi, fujiDeployment } from '@askpay/shared/abi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useBlock, useConfig, useReadContract, useSignTypedData, useWriteContract } from 'wagmi';
import { getTransactionReceipt, simulateContract } from 'wagmi/actions';
import { CHAIN_STATUSES, isSettled } from '@/components/question/status';
import { useUsdcBalance } from '@/components/wallet/use-usdc-balance';
import { useWalletStatus } from '@/components/wallet/use-wallet-status';
import { FUJI_CHAIN_ID } from '@/lib/constants';
import { classifyWalletError } from '@/lib/wallet-errors';
import { classifyClaimError, isInsufficientGas, refundedByClaim } from './claim';
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
import { hasUnverifiedCitation, type ChainRead } from './result-view';
import { classifySubmit } from './submit-outcome';

// --- Polling a question (shared with the result page, W3) -------------------------------------

class NotFoundError extends Error {}

// Design W3 §7: a PAID card the server could not match to the chain is asked again after these
// delays (3, 6, 12, 24 s), then the page stops and keeps its "not verified yet" line.
const VERIFY_RETRY_MS = [3000, 6000, 12000, 24000];
// A closed status without the settlement tx is read every second, at most this many times (about
// 30 s). Past that the page stops and offers a manual retry, so a tab never polls for ever.
const SETTLE_POLL_MS = 1000;
export const SETTLE_POLL_LIMIT = 30;
const CLAIMABLE_POLL_MS = 10_000;

export type PollContext = {
  // Reads so far that were settled PAID with an unmatched card.
  unverifiedReads: number;
  // Reads so far that were PAID/REFUNDED but without the settlement tx.
  unsettledReads: number;
  hidden: boolean;
};

// How long until the next read, false to stop, undefined to leave the W2 cadence to the caller.
export function nextPollDelay(
  data: QuestionResult | undefined,
  { unverifiedReads, unsettledReads, hidden }: PollContext,
): number | false | undefined {
  if (!data) return undefined;
  if (data.stage === 'EXPIRED') return false;
  if (data.status === 'CLAIMABLE') {
    // `settle` can still run after the deadline, so CLAIMABLE may become PAID or REFUNDED. Slow
    // poll, and none in a background tab (the focus refetch restarts it).
    return hidden ? false : CLAIMABLE_POLL_MS;
  }
  if (data.status === 'PAID' || data.status === 'REFUNDED') {
    // Closed status without the settlement tx is not "settled" yet (isSettled): keep reading, but
    // only for a bounded number of reads.
    if (!isSettled(data)) return unsettledReads <= SETTLE_POLL_LIMIT ? SETTLE_POLL_MS : false;
    if (hasUnverifiedCitation(data)) return VERIFY_RETRY_MS[unverifiedReads - 1] ?? false;
    return false;
  }
  return undefined;
}

// After the payer's own claimRefund the chain is ahead of the indexer: read the API more often, so
// the page can hand over to its answer soon (W5 §4).
const CLAIMED_POLL_MS = 3000;

type PollInput = {
  data: QuestionResult | undefined;
  notFound: boolean;
  backoff: boolean;
  dataUpdateCount: number;
  fast: boolean;
} & PollContext;

// The one rule for "is another read scheduled, and when" (used by refetchInterval and by the view).
function pollInterval({ data, notFound, backoff, dataUpdateCount, fast, ...context }: PollInput) {
  // The question was refunded by the payer's own tx: ask every 3 s until the API says so too.
  if (fast && !(data?.status === 'REFUNDED' && isSettled(data))) return CLAIMED_POLL_MS;
  // The result page stops on a 404 (the chain read of W5 goes on at its own pace); while a payment
  // is unsure a 404 proves nothing, keep going.
  if (!backoff && notFound) return false;
  const delay = nextPollDelay(data, context);
  if (delay !== undefined) return delay;
  // T-07: every second; after ~30 answers, every 3 s (used while the outcome is unsure).
  return backoff && dataUpdateCount >= 30 ? 3000 : 1000;
}

export function useQuestionProgress(
  qid: string | undefined,
  options: { backoff?: boolean; fast?: boolean } = {},
) {
  const backoff = options.backoff ?? false;
  const fast = options.fast ?? false;
  // Read counters, in a ref for refetchInterval (sync) and in state for rendering (a read with
  // identical data does not re-render by itself). They start again on a page reload or a retry.
  const reads = useRef({ unverified: 0, unsettled: 0 });
  const [readCounts, setReadCounts] = useState({ unverified: 0, unsettled: 0 });
  const query = useQuery({
    queryKey: ['question', qid],
    enabled: qid !== undefined,
    retry: false,
    // Keep polling in a background tab: the wallet popup can take focus away from this one.
    refetchIntervalInBackground: true,
    refetchInterval: (q) =>
      pollInterval({
        data: q.state.data,
        notFound: q.state.error instanceof NotFoundError,
        backoff,
        dataUpdateCount: q.state.dataUpdateCount,
        fast,
        unverifiedReads: reads.current.unverified,
        unsettledReads: reads.current.unsettled,
        hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      }),
    queryFn: async (): Promise<QuestionResult> => {
      const result = await getQuestion(qid as string);
      if (result.kind === 'data') {
        const closed = result.data.status === 'PAID' || result.data.status === 'REFUNDED';
        if (hasUnverifiedCitation(result.data)) reads.current.unverified += 1;
        else if (closed && !isSettled(result.data)) reads.current.unsettled += 1;
        else return result.data;
        setReadCounts({ ...reads.current });
        return result.data;
      }
      if (result.kind === 'error' && result.code === 'QUESTION_NOT_FOUND')
        throw new NotFoundError();
      throw new Error('Could not load the question');
    },
  });

  const notFound = query.error instanceof NotFoundError;
  // Would another read happen? A hidden tab counts as yes: the focus refetch resumes it.
  const polling =
    pollInterval({
      data: query.data,
      notFound,
      backoff,
      // Only the 3 s step of the payment flow (`backoff`) uses this; the view needs `polling` on
      // the result page alone.
      dataUpdateCount: 0,
      fast,
      unverifiedReads: readCounts.unverified,
      unsettledReads: readCounts.unsettled,
      hidden: false,
    }) !== false;
  const { refetch } = query;
  // A manual retry gives the page its allowance of reads back.
  const retry = useCallback(async () => {
    reads.current = { unverified: 0, unsettled: 0 };
    setReadCounts({ unverified: 0, unsettled: 0 });
    await refetch();
  }, [refetch]);

  return {
    question: query.data,
    notFound,
    // A failed refresh keeps the last data on screen; the view tells "no data" from "stale data".
    loadFailed: query.isError && !notFound,
    isLoading: query.isLoading,
    polling,
    // True while a PAID card is still being matched to the chain and more reads are scheduled.
    verifyRetrying:
      query.data !== undefined &&
      hasUnverifiedCitation(query.data) &&
      readCounts.unverified <= VERIFY_RETRY_MS.length,
    refetch,
    retry,
  };
}

// --- The escrow read straight from the chain (W5 §2.2) ----------------------------------------------

const CHAIN_POLL_MS = 15_000;
// The API does not know a question's `deadline` until the indexer reads its Deposited log. A PENDING
// page past createdAt + answerWindow + this margin (machine clock) reads the chain itself (§2.1 #3).
const OVERDUE_MARGIN_MS = 30_000;

// True once `createdAt` (ms) + the answer window + the margin has passed on the machine's clock. Only
// decides whether to ASK the chain; the verdict always comes from the chain's own block time.
export function useApiOverdue(createdAt: number | undefined): boolean {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (createdAt === undefined) return;
    const at = createdAt + fujiDeployment.answerWindow * 1000 + OVERDUE_MARGIN_MS;
    const wait = at - Date.now();
    if (wait <= 0) {
      setOverdue(true);
      return;
    }
    setOverdue(false);
    const id = setTimeout(() => setOverdue(true), wait);
    return () => clearTimeout(id);
  }, [createdAt]);
  return overdue;
}

// Reads `questions(qid)` and the latest block with the public client: no wallet, no AskPay server.
// Re-read every 15 s while the tab is open. Off (and silent) until `enabled`.
export function useOnChainQuestion(
  qid: string | undefined,
  enabled: boolean,
): { read: ChainRead; refetch: () => void } {
  const active = enabled && qid !== undefined && isBytes32(qid);
  const question = useReadContract({
    abi: askPayEscrowAbi,
    address: fujiDeployment.address,
    functionName: 'questions',
    args: [qid as Hex],
    chainId: FUJI_CHAIN_ID,
    query: { enabled: active, refetchInterval: CHAIN_POLL_MS, retry: 1, retryDelay: 500 },
  });
  const block = useBlock({
    chainId: FUJI_CHAIN_ID,
    query: { enabled: active, refetchInterval: CHAIN_POLL_MS, retry: 1, retryDelay: 500 },
  });
  const { refetch: refetchQuestion } = question;
  const { refetch: refetchBlock } = block;
  const refetch = useCallback(() => {
    void refetchQuestion();
    void refetchBlock();
  }, [refetchQuestion, refetchBlock]);

  if (!active) return { read: { kind: 'off' }, refetch };
  if (question.data && block.data) {
    const [payer, amount, deadline, status] = question.data;
    return {
      read: {
        kind: 'data',
        status: CHAIN_STATUSES[Number(status)] ?? 'None',
        payer,
        amount,
        deadline: Number(deadline),
        now: Number(block.data.timestamp),
      },
      refetch,
    };
  }
  // A failed refresh keeps the last good read on screen; only "nothing yet" counts as failed.
  if (question.isError || block.isError) return { read: { kind: 'failed' }, refetch };
  return { read: { kind: 'loading' }, refetch };
}

const isBytes32 = (value: string): value is Hex => /^0x[0-9a-f]{64}$/i.test(value);

// --- useClaimRefund (W5 §3) ----------------------------------------------------------------------

export type ClaimState =
  | { kind: 'idle'; rejected?: true }
  | { kind: 'simulating' }
  | { kind: 'confirming' }
  | { kind: 'pending'; hash: Hex; slow: boolean }
  // `byPayer`: the wallet that clicked is the asker. Anyone may claim; the money goes to `payer`.
  | { kind: 'refunded'; hash: Hex; payer: Address; byPayer: boolean }
  // Someone else closed it first. `wasted` is true when OUR tx went out and reverted (it cost gas).
  | { kind: 'alreadyClosed'; wasted: boolean }
  | { kind: 'notYet'; deadline: number | undefined }
  | { kind: 'failed'; error: 'rpc' | 'noGas' | 'wallet' | 'other' };

const RECEIPT_FAST_MS = 2000;
const RECEIPT_SLOW_MS = 5000;
const RECEIPT_SLOW_AFTER_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The payer's way out when the server is gone: simulate, open the wallet, wait for the receipt, and
// accept it only when it carries the escrow's own Refunded log for this qid (U-21). One tx per
// click; nothing is ever sent without one.
export function useClaimRefund(qid: string) {
  const wallet = useWalletStatus();
  const config = useConfig();
  const queryClient = useQueryClient();
  const balanceKey = useUsdcBalance().queryKey;
  const { mutateAsync: writeContract } = useWriteContract();

  const [state, setStateRaw] = useState<ClaimState>({ kind: 'idle' });
  const stateRef = useRef(state);
  const walletRef = useRef(wallet);
  // Bumped when an unsent step is abandoned (account or network changed); late answers then do nothing.
  const flowRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    walletRef.current = wallet;
  });

  const setState = useCallback((next: ClaimState) => {
    stateRef.current = next;
    if (aliveRef.current) setStateRaw(next);
  }, []);

  // After any end of the flow the API and the chain are read again (§3.2: "refetch ... rồi hiện
  // trạng thái cuối"), and the balance too.
  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: balanceKey });
    void queryClient.invalidateQueries({ queryKey: ['question', qid] });
    void queryClient.invalidateQueries({ queryKey: ['readContract'] });
    void queryClient.invalidateQueries({ queryKey: ['getBlock'] });
  }, [queryClient, balanceKey, qid]);

  const waitForReceipt = useCallback(
    async (hash: Hex, claimer: Address) => {
      const startedAt = Date.now();
      for (;;) {
        try {
          const receipt = await getTransactionReceipt(config, { hash, chainId: FUJI_CHAIN_ID });
          if (receipt.status === 'reverted') {
            setState({ kind: 'alreadyClosed', wasted: true });
            refreshAll();
            return;
          }
          const proof = refundedByClaim(receipt, qid as Hex);
          if (proof) {
            setState({
              kind: 'refunded',
              hash,
              payer: proof.payer,
              byPayer: proof.payer.toLowerCase() === claimer.toLowerCase(),
            });
            refreshAll();
            return;
          }
          // A success without our log is not proof of anything: keep the page on what it can prove.
          setState({ kind: 'failed', error: 'other' });
          refreshAll();
          return;
        } catch {
          // Not mined yet, or the node did not answer: ask again. Never invite a second tx.
        }
        if (!aliveRef.current) return;
        const waited = Date.now() - startedAt;
        if (waited >= RECEIPT_SLOW_AFTER_MS && stateRef.current.kind === 'pending') {
          if (!stateRef.current.slow) setState({ kind: 'pending', hash, slow: true });
        }
        await sleep(waited >= RECEIPT_SLOW_AFTER_MS ? RECEIPT_SLOW_MS : RECEIPT_FAST_MS);
      }
    },
    [config, qid, refreshAll, setState],
  );

  const claim = useCallback(async () => {
    const current = stateRef.current;
    const from = walletRef.current;
    if (current.kind === 'simulating' || current.kind === 'confirming') return;
    if (current.kind === 'pending' || current.kind === 'refunded') return;
    if (from.kind !== 'ready') return;

    const flow = (flowRef.current += 1);
    setState({ kind: 'simulating' });
    let request;
    try {
      ({ request } = await simulateContract(config, {
        abi: askPayEscrowAbi,
        address: fujiDeployment.address,
        functionName: 'claimRefund',
        args: [qid as Hex],
        account: from.address,
        chainId: FUJI_CHAIN_ID,
      }));
    } catch (error) {
      if (flow !== flowRef.current || !aliveRef.current) return;
      const failure = classifyClaimError(error);
      if (failure.kind === 'notOpen') {
        // Not an error: someone settled it first (system-design §5.6 E). No wallet was opened.
        setState({ kind: 'alreadyClosed', wasted: false });
        refreshAll();
      } else if (failure.kind === 'notYet') {
        setState({
          kind: 'notYet',
          deadline: failure.deadline === undefined ? undefined : Number(failure.deadline),
        });
      } else {
        setState({ kind: 'failed', error: failure.kind === 'rpc' ? 'rpc' : 'other' });
      }
      return;
    }
    // The account or network changed while simulating, or the page was left: nothing was sent, and
    // nothing will be (a wallet prompt must never appear for a page that is gone).
    if (flow !== flowRef.current || !aliveRef.current) return;

    setState({ kind: 'confirming' });
    let hash: Hex;
    try {
      hash = await writeContract(request);
    } catch (error) {
      if (flow !== flowRef.current) return;
      const kind = classifyWalletError(error);
      if (kind === 'rejected') setState({ kind: 'idle', rejected: true });
      else if (isInsufficientGas(error)) setState({ kind: 'failed', error: 'noGas' });
      else setState({ kind: 'failed', error: 'wallet' });
      return;
    }
    // A hash exists: the tx is out of the wallet's hands, so from here nothing is abandoned.
    setState({ kind: 'pending', hash, slow: false });
    await waitForReceipt(hash, from.address);
  }, [config, qid, refreshAll, setState, waitForReceipt, writeContract]);

  // §3.2: a new account or network drops an unsent step. A sent tx is never cancelled.
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
    if (current.kind === 'simulating' || current.kind === 'confirming') {
      flowRef.current += 1;
      setState({ kind: 'idle' });
    }
  }, [walletKey, setState]);

  // "Not yet" waits for the chain's own clock: poll the block until it passes the deadline.
  const waiting = state.kind === 'notYet';
  const block = useBlock({
    chainId: FUJI_CHAIN_ID,
    query: { enabled: waiting, refetchInterval: 3000 },
  });
  const blockTime = block.data ? Number(block.data.timestamp) : undefined;
  useEffect(() => {
    const current = stateRef.current;
    if (current.kind !== 'notYet' || blockTime === undefined) return;
    if (current.deadline === undefined || blockTime > current.deadline) setState({ kind: 'idle' });
  }, [blockTime, setState, state]);

  return { state, claim, blockTime };
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
