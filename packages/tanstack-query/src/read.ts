import type { QueryClient, QueryKey } from '@tanstack/query-core';

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
