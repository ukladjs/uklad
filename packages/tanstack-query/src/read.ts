import type { QueryClient, QueryKey, QueryState } from '@tanstack/query-core';

/**
 * The read-only cache capability exposed to attachment-managed coeffects.
 *
 * It intentionally contains synchronous snapshots only. Imperative QueryClient
 * operations such as fetching, invalidating, mutating, and removing queries
 * remain outside event and coeffect code.
 */
export interface QueryCacheReader {
  getData<TData = unknown, TQueryKey extends QueryKey = QueryKey>(
    queryKey: TQueryKey,
  ): TData | undefined;

  getState<TData = unknown, TError = Error, TQueryKey extends QueryKey = QueryKey>(
    queryKey: TQueryKey,
  ): Readonly<QueryState<TData, TError>> | undefined;
}

/**
 * Read one cached result without exposing the QueryClient to an event handler.
 *
 * Register this function (or a narrow wrapper around it) as an Uklad coeffect
 * when an event needs a synchronous cache snapshot. It never fetches or
 * mutates query state.
 */
export function readQueryData<TData = unknown, TQueryKey extends QueryKey = QueryKey>(
  queryClient: QueryClient,
  queryKey: TQueryKey,
): TData | undefined {
  return queryClient.getQueryData<TData, TQueryKey>(queryKey);
}

/**
 * Read one cached query state without exposing the QueryClient to an event
 * handler. The returned object is a shallow-frozen snapshot, so callers
 * cannot mutate TanStack Query's internal state object.
 */
export function readQueryState<
  TData = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(queryClient: QueryClient, queryKey: TQueryKey): Readonly<QueryState<TData, TError>> | undefined {
  const state = queryClient.getQueryState<TData, TError, TQueryKey>(queryKey);
  return state === undefined ? undefined : freezeQueryState(state);
}

/** @internal Build the frozen capability captured by one QueryClient attachment. */
export function createQueryCacheReader(queryClient: QueryClient): QueryCacheReader {
  const reader: QueryCacheReader = {
    getData: <TData = unknown, TQueryKey extends QueryKey = QueryKey>(
      queryKey: TQueryKey,
    ): TData | undefined => readQueryData<TData, TQueryKey>(queryClient, queryKey),
    getState: <TData = unknown, TError = Error, TQueryKey extends QueryKey = QueryKey>(
      queryKey: TQueryKey,
    ): Readonly<QueryState<TData, TError>> | undefined =>
      readQueryState<TData, TError, TQueryKey>(queryClient, queryKey),
  };
  return Object.freeze(reader);
}

function freezeQueryState<TData, TError>(
  state: QueryState<TData, TError>,
): Readonly<QueryState<TData, TError>> {
  return Object.freeze({ ...state });
}
