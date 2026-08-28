/** Headless TanStack Query integration for Uklad. */

export { QueryClient } from '@tanstack/query-core';
export { attachQueryClient } from './lifecycle';
export { regQueryProjection, regQuerySub } from './query-subscription';
export { readQueryData, readQueryState } from './read';
export type { AttachQueryClientOptions, QueryCacheCoeffectDefinition } from './lifecycle';
export type { QueryCacheReader } from './read';
export type { QuerySnapshot } from './query-snapshot';
export type {
  QueryResultMapper,
  QueryProjectionTarget,
  QuerySubscriptionConfig,
  QuerySubscriptionObserve,
  QuerySubscriptionObservedProperty,
} from './query-subscription';
export type {
  FetchStatus,
  QueryClientConfig,
  QueryKey,
  QueryObserverOptions,
  QueryStatus,
} from '@tanstack/query-core';
