'use client';

import type { QuestionListItem } from '@askpay/shared/api';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getQuestions, getStats, LoadError } from './api';

// Design W4 §7 (U-17): the numbers and the first page of the table are read again every 15 s while
// the tab is open, and when the window regains focus. A background tab does not poll.
export const REFRESH_MS = 15_000;

const refresh = {
  // A failed read is shown (and the next interval retries); TanStack's own retries would hide it.
  retry: false,
  refetchInterval: REFRESH_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

export function useStats() {
  return useQuery({ queryKey: ['dashboard', 'stats'], queryFn: getStats, ...refresh });
}

export type LoadMoreState = 'idle' | 'loading' | 'failed';

type Extra = { items: QuestionListItem[]; nextCursor: string | undefined };

// Page 1 is a query (and refreshes). Page 2 onwards is local state: it is read on demand and never
// refreshed, so `useInfiniteQuery` (which re-reads every loaded page) does not fit.
export function useRecentQuestions() {
  const first = useQuery({
    queryKey: ['dashboard', 'questions'],
    queryFn: () => getQuestions(),
    ...refresh,
  });
  const [extra, setExtra] = useState<Extra>({ items: [], nextCursor: undefined });
  const [loadedPages, setLoadedPages] = useState(0);
  const [loadState, setLoadState] = useState<LoadMoreState>('idle');
  // What the last "Xem thêm" added; `seq` makes two loads of the same size distinct for the view.
  const [lastLoad, setLastLoad] = useState<{ seq: number; added: number; firstQid: string }>();

  const firstItems = first.data?.items;

  // New questions arriving push old rows off page 1. Once page 2 is loaded those rows are on
  // neither page, so keep them with the loaded rows instead of letting them vanish.
  const previousFirst = useRef<QuestionListItem[]>([]);
  useEffect(() => {
    const previous = previousFirst.current;
    previousFirst.current = firstItems ?? [];
    if (loadedPages === 0 || !firstItems) return;
    const now = new Set(firstItems.map((item) => item.qid));
    const pushedOff = previous.filter((item) => !now.has(item.qid));
    if (pushedOff.length === 0) return;
    setExtra((current) => {
      const have = new Set(current.items.map((item) => item.qid));
      return {
        ...current,
        items: [...current.items, ...pushedOff.filter((i) => !have.has(i.qid))],
      };
    });
  }, [firstItems, loadedPages]);

  // Page 1 wins on a repeated qid: it is the newest read of that row. The order is the API's:
  // createdAt descending, then qid descending.
  const rows = useMemo(() => {
    const seen = new Set((firstItems ?? []).map((item) => item.qid));
    const rest = extra.items.filter((item) => !seen.has(item.qid) && seen.add(item.qid));
    return [...(firstItems ?? []), ...rest].sort(
      (a, b) => b.createdAt - a.createdAt || (a.qid < b.qid ? 1 : a.qid > b.qid ? -1 : 0),
    );
  }, [firstItems, extra.items]);

  const nextCursor = loadedPages > 0 ? extra.nextCursor : first.data?.nextCursor;

  const loadMore = useCallback(async () => {
    if (nextCursor === undefined || loadState === 'loading') return;
    setLoadState('loading');
    try {
      const page = await getQuestions(nextCursor);
      const known = new Set(rows.map((row) => row.qid));
      const added = page.items.filter((item) => !known.has(item.qid));
      setExtra((current) => ({
        items: [...current.items, ...added],
        nextCursor: page.nextCursor,
      }));
      setLoadedPages((count) => count + 1);
      const firstNew = added[0];
      if (firstNew) {
        setLastLoad((previous) => ({
          seq: (previous?.seq ?? 0) + 1,
          added: added.length,
          firstQid: firstNew.qid,
        }));
      }
      setLoadState('idle');
    } catch {
      setLoadState('failed');
    }
  }, [nextCursor, loadState, rows]);

  return {
    rows,
    nextCursor,
    loadMore,
    loadState,
    lastLoad,
    // No rows to show yet: loading, or failed before the first success.
    pending: first.isPending,
    failed: first.isError && first.data === undefined,
    errorCode: first.error instanceof LoadError ? first.error.code : undefined,
    retry: () => void first.refetch(),
  };
}
