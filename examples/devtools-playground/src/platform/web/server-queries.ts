import { QueryClient, attachQueryClient, regQuerySub } from '@ukladjs/tanstack-query';
import type { QuerySnapshot } from '@ukladjs/tanstack-query';
import type {
  UkladDisposer,
  UkladModule,
  UkladRegistrar,
  UkladRuntime,
} from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import type {
  ServerClock,
  ServerItem,
  ServerQueryResult,
  ServerRegionSummary,
} from '../../features/server/state';
import type { PlaygroundServerApi } from './server-api';

export const playgroundServerKeys = {
  all: ['devtools-playground-server'] as const,
  clock: () => [...playgroundServerKeys.all, 'clock'] as const,
  item: (itemId: number) => [...playgroundServerKeys.all, 'item', itemId] as const,
  region: (region: string) => [...playgroundServerKeys.all, 'region', region] as const,
} as const;

export function createPlaygroundQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** Install all three browser-backed cache-owned query subscriptions. */
export function installServerQueries(
  runtime: UkladRuntime<AppContracts>,
  queryClient: QueryClient,
  api: PlaygroundServerApi,
): UkladDisposer {
  const detachQueryClient = attachQueryClient(runtime, queryClient);
  const disposeQueries = runtime.registerModule(createServerQueries(queryClient, api));
  return () => {
    disposeQueries();
    detachQueryClient();
  };
}

function createServerQueries(
  queryClient: QueryClient,
  api: PlaygroundServerApi,
): UkladModule<UkladRegistrar<AppContracts>> {
  return (registrar) => {
    // 1. No parameters: TanStack refetches from the ticking server once a second.
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.serverClock,
      () => [],
      () => ({
        queryKey: playgroundServerKeys.clock(),
        queryFn: ({ signal }) => api.clock(signal),
        refetchInterval: 1_000,
        staleTime: 30_000,
      }),
      (query) => toServerResult<ServerClock>(query),
    );

    // 2. The subscription parameter is the query coordinate. Each vector owns
    // one external node and one matching TanStack observer while active.
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.serverItemById,
      () => [],
      (_signals, itemId) => ({
        queryKey: playgroundServerKeys.item(itemId),
        queryFn: ({ signal }) => api.item(itemId, signal),
        staleTime: 30_000,
      }),
      (query) => toServerResult<ServerItem>(query),
    );

    // 3. Region is a real graph dependency. Changing it rebinds the active
    // observer while a cached destination remains synchronously readable.
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.serverRegionSummary,
      () => [[appIds.subscriptions.serverRegion]],
      ([region]) => ({
        queryKey: playgroundServerKeys.region(region),
        queryFn: ({ signal }) => api.region(region, signal),
        staleTime: 30_000,
      }),
      (query) => toServerResult<ServerRegionSummary>(query),
    );
  };
}

function toServerResult<TData>(
  query: Pick<QuerySnapshot<TData>, 'data' | 'error'>,
): ServerQueryResult<TData> {
  if (query.error !== null) return { kind: 'error', message: query.error.message };
  if (query.data === undefined) return { kind: 'loading' };
  return { kind: 'ready', data: query.data };
}
