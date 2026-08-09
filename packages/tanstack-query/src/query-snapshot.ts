import type { FetchStatus, QueryObserverResult, QueryStatus } from '@tanstack/query-core';

/**
 * Read-only TanStack observer state passed into a Uklad query mapper.
 *
 * It intentionally excludes imperative observer methods such as `refetch`:
 * commands belong in Uklad effects, while this value is safe to consume from a
 * view or a read-only coeffect.
 */
export interface QuerySnapshot<TData, TError = Error> {
  readonly data: TData | undefined;
  readonly error: TError | null;
  readonly status: QueryStatus;
  readonly fetchStatus: FetchStatus;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
  readonly failureCount: number;
  readonly failureReason: TError | null;
  readonly isError: boolean;
  readonly isFetched: boolean;
  readonly isFetching: boolean;
  readonly isLoading: boolean;
  readonly isPending: boolean;
  readonly isPaused: boolean;
  readonly isPlaceholderData: boolean;
  readonly isRefetching: boolean;
  readonly isStale: boolean;
  readonly isSuccess: boolean;
}

/** Convert TanStack's mutable observer result shape into a read-only value. */
export function toQuerySnapshot<TData, TError>(
  result: QueryObserverResult<TData, TError>,
): QuerySnapshot<TData, TError> {
  return Object.freeze({
    data: result.data,
    error: result.error,
    status: result.status,
    fetchStatus: result.fetchStatus,
    dataUpdatedAt: result.dataUpdatedAt,
    errorUpdatedAt: result.errorUpdatedAt,
    failureCount: result.failureCount,
    failureReason: result.failureReason,
    isError: result.isError,
    isFetched: result.isFetched,
    isFetching: result.isFetching,
    isLoading: result.isLoading,
    isPending: result.isPending,
    isPaused: result.isPaused,
    isPlaceholderData: result.isPlaceholderData,
    isRefetching: result.isRefetching,
    isStale: result.isStale,
    isSuccess: result.isSuccess,
  });
}
