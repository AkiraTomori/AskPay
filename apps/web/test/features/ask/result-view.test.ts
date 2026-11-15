import { questionResultSchema, type QuestionResult } from '@askpay/shared/api';
import { describe, expect, it } from 'vitest';
import {
  hasUnverifiedCitation,
  isSettled,
  toResultView,
  type ResultView,
} from '@/features/ask/result-view';
import { citation, paidBody, refundedBody, resultBody, SETTLE_TX } from '../../helpers/ask-api';

const parse = (body: Record<string, unknown>): QuestionResult => questionResultSchema.parse(body);
const view = (
  body: Record<string, unknown>,
  over: { loadFailed?: boolean; polling?: boolean } = {},
) =>
  toResultView({
    result: parse(body),
    notFound: false,
    loadFailed: over.loadFailed ?? false,
    polling: over.polling ?? true,
  });
const question = (v: ResultView) => {
  if (v.kind !== 'question') throw new Error(`expected a question view, got ${v.kind}`);
  return v;
};

describe('isSettled (design W3 §3)', () => {
  it('needs a closed status and the settlement tx', () => {
    expect(isSettled(parse(paidBody()))).toBe(true);
    expect(isSettled(parse(refundedBody('TIMEOUT')))).toBe(true);
    expect(isSettled(parse(paidBody({ tx: { deposit: SETTLE_TX } })))).toBe(false);
    expect(isSettled(parse(resultBody({ stage: 'SETTLING', status: 'PENDING' })))).toBe(false);
    expect(isSettled(parse(resultBody({ stage: 'SETTLING', status: 'CLAIMABLE' })))).toBe(false);
  });
});

describe('toResultView: the state table (design W3 §4)', () => {
  it('no data: loading, load failed, not found', () => {
    expect(
      toResultView({ result: undefined, notFound: false, polling: true, loadFailed: false }).kind,
    ).toBe('loading');
    expect(
      toResultView({ result: undefined, notFound: false, polling: true, loadFailed: true }).kind,
    ).toBe('loadFailed');
    expect(
      toResultView({ result: undefined, notFound: true, polling: true, loadFailed: false }).kind,
    ).toBe('notFound');
  });

  it('a question that holds no money is "not held", never paid', () => {
    expect(view(resultBody({ stage: 'QUOTED' })).kind).toBe('notHeld');
    expect(view(resultBody({ stage: 'EXPIRED' })).kind).toBe('notHeld');
  });

  it('AP-07-AC03: PENDING shows a skeleton even when the API already has the answer (U-12)', () => {
    for (const stage of ['DEPOSITING', 'ANSWERING', 'CHECKING', 'SETTLING']) {
      const v = question(view(paidBody({ stage, status: 'PENDING', tx: { deposit: SETTLE_TX } })));
      expect(v.badge).toBe('pending');
      expect(v.answer).toEqual({ skeleton: true });
      expect(v.citations).toEqual([]);
      expect(v.actions).toEqual([]);
    }
  });

  it('AP-07-AC03: a closed status without the settlement tx is still "pending"', () => {
    const v = question(view(paidBody({ tx: { deposit: SETTLE_TX } })));
    expect(v.badge).toBe('pending');
    expect(v.settled).toBe(false);
    expect(v.answer).toEqual({ skeleton: true });
    expect(v.citations).toEqual([]);
  });

  it('PAID and settled: paid, answer, cards with the two-line mark only when verifiedOnChain', () => {
    const v = question(
      view(
        paidBody({
          citations: [citation(), citation({ dieu: 7, verifiedOnChain: false })],
        }),
      ),
    );
    expect(v.badge).toBe('paid');
    expect(v.answer).toMatchObject({ tone: 'normal' });
    expect(v.citations.map((c) => [c.tone, c.verified])).toEqual([
      ['paid', true],
      ['paid', false],
    ]);
    expect(v.verifying).toBe(true);
    expect(v.actions).toEqual(['askAnother']);
    expect(v.meta).toMatchObject({ amount: 50000n, settleKind: 'paid' });
  });

  it('keeps the API order of the cards', () => {
    const v = question(
      view(paidBody({ citations: [citation({ dieu: 90 }), citation({ dieu: 5 })] })),
    );
    expect(v.citations.map((c) => c.citation.dieu)).toEqual([90, 5]);
  });

  it('REFUNDED NO_CITATION: no cards; the answer warning only when noBasis is false (Q-04)', () => {
    const base = { answer: 'Không có căn cứ.', citations: [citation()] };
    const noBasis = question(view(refundedBody('NO_CITATION', { ...base, noBasis: true })));
    expect(noBasis.notice).toEqual({ kind: 'noBasis', warnsAnswer: false });
    expect(noBasis.answer).toMatchObject({ tone: 'muted' });
    expect(noBasis.citations).toEqual([]);
    const answered = question(view(refundedBody('NO_CITATION', { ...base, noBasis: false })));
    expect(answered.notice).toEqual({ kind: 'noBasis', warnsAnswer: true });
  });

  it('REFUNDED INVALID_CITATION / CHECKER_REJECTED: muted answer, refund cards, no tick', () => {
    for (const reason of ['INVALID_CITATION', 'CHECKER_REJECTED'] as const) {
      const v = question(
        view(
          refundedBody(reason, { answer: 'x', citations: [citation({ verifiedOnChain: true })] }),
        ),
      );
      expect(v.badge).toBe('refunded');
      expect(v.notice).toEqual({ kind: 'failedCheck', reason, warnsAnswer: true });
      expect(v.answer).toMatchObject({ tone: 'muted' });
      expect(v.citations).toEqual([expect.objectContaining({ tone: 'refund', verified: false })]);
      expect(v.verifying).toBe(false);
    }
  });

  it('REFUNDED ANSWER_FAILED: no answer, "ask again"', () => {
    const v = question(view(refundedBody('ANSWER_FAILED', { answer: null })));
    expect(v.notice).toEqual({ kind: 'answerFailed' });
    expect(v.answer).toBeUndefined();
    expect(v.actions).toEqual(['askAgain']);
  });

  it('REFUNDED TIMEOUT: refund link kind; warning only with an answer', () => {
    const none = question(view(refundedBody('TIMEOUT')));
    expect(none.notice).toEqual({ kind: 'timeout', warnsAnswer: false });
    expect(none.meta.settleKind).toBe('refund');
    const answered = question(
      view(refundedBody('TIMEOUT', { answer: 'x', citations: [citation()] })),
    );
    expect(answered.notice).toEqual({ kind: 'timeout', warnsAnswer: true });
    expect(answered.citations[0]).toMatchObject({ tone: 'refund', verified: false });
  });

  it('REFUNDED without a reason: the generic line; the reason is not guessed', () => {
    expect(question(view(refundedBody(null))).notice).toEqual({ kind: 'generic' });
    expect(question(view(refundedBody(null, { reason: undefined }))).notice).toEqual({
      kind: 'generic',
    });
  });

  it('CLAIMABLE: expired badge, overdue notice, no timeline, no button', () => {
    const v = question(view(resultBody({ stage: 'SETTLING', status: 'CLAIMABLE' })));
    expect(v.badge).toBe('expired');
    expect(v.notice).toEqual({ kind: 'claimable' });
    expect(v.timeline).toBeUndefined();
    expect(v.actions).toEqual([]);
  });

  it('a failed refresh with another one scheduled says "retrying", and keeps the data', () => {
    const v = question(view(paidBody(), { loadFailed: true, polling: true }));
    expect(v.refresh).toBe('retrying');
    expect(v.badge).toBe('paid');
  });

  it('a failed refresh with nothing scheduled says the connection is lost, never "retrying"', () => {
    const v = question(view(paidBody(), { loadFailed: true, polling: false }));
    expect(v.refresh).toBe('lostConnection');
    expect(v.badge).toBe('paid');
  });

  it('closed without a settlement tx and no read scheduled: "unsettled"; still polling: "live"', () => {
    const closed = paidBody({ tx: { deposit: SETTLE_TX } });
    expect(question(view(closed, { polling: false })).refresh).toBe('unsettled');
    expect(question(view(closed, { polling: true })).refresh).toBe('live');
    expect(question(view(paidBody(), { polling: false })).refresh).toBe('live');
    expect(
      question(view(resultBody({ stage: 'ANSWERING', status: 'PENDING' }), { polling: false }))
        .refresh,
    ).toBe('live');
  });
});

describe('hasUnverifiedCitation', () => {
  it('is true only for a settled PAID question with an unmatched card', () => {
    expect(hasUnverifiedCitation(parse(paidBody()))).toBe(false);
    expect(
      hasUnverifiedCitation(parse(paidBody({ citations: [citation({ verifiedOnChain: false })] }))),
    ).toBe(true);
    expect(
      hasUnverifiedCitation(
        parse(refundedBody('TIMEOUT', { citations: [citation({ verifiedOnChain: false })] })),
      ),
    ).toBe(false);
  });
});
