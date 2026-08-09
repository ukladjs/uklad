/** Headless TanStack Query integration for Uklad. */

export { QueryClient } from '@tanstack/query-core';
export { attachQueryClient } from './lifecycle';
export { regQuerySub } from './query-subscription';
export { readQueryData } from './read';
export type { QuerySnapshot } from './query-snapshot';
export type {
  QueryResultMapper,
  QuerySubscriptionConfig,
  QuerySubscriptionObserve,
  QuerySubscriptionObservedProperty,
  QuerySubscriptionTarget,
} from './query-subscription';
export type {
  FetchStatus,
  QueryClientConfig,
  QueryKey,
  QueryObserverOptions,
  QueryStatus,
} from '@tanstack/query-core';
