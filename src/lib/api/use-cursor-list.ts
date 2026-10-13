'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { ApiError } from './errors';
import { mergeCursorPages } from './cursor';

type CursorPage<T> = { items: T[]; nextCursor: string | null };

export function useCursorList<T, TFilters extends object>(
  queryKey: readonly unknown[],
  filters: TFilters,
  loadPage: (filters: TFilters, cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>,
) {
  const query = useInfiniteQuery({
    queryKey: [...queryKey, filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadPage(filters, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 1_500),
  });
  const items = mergeCursorPages(query.data?.pages ?? []);
  return { ...query, items, hasMore: Boolean(query.hasNextPage) };
}
