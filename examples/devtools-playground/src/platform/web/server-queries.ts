import { QueryClient, attachQueryClient, regQuerySub } from '@ukladjs/tanstack-query';
import type { QuerySnapshot } from '@ukladjs/tanstack-query';
import type {
  UkladDisposer,
  UkladModule,
  UkladRegistrar,
  UkladRuntime,
} from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import type {
  ServerClock,
  ServerItem,
  ServerItems,
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

/** Install all three browser-backed query extensions on their ordinary subscriptions. */
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
      {
        stateKey: stateKeys.serverClock,
        update: (_current, value) => value,
      },
      () => [],
      () => ({
        queryKey: playgroundServerKeys.clock(),
        queryFn: ({ signal }) => api.clock(signal),
        refetchInterval: 1_000,
      }),
      (query) => toServerResult<ServerClock>(query),
    );

    // 2. The parameterized subscription owns the observer lifecycle while
    // each mapped result is merged into its explicit backing root.
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.serverItemById,
      {
        stateKey: stateKeys.serverItems,
        update: (items, value, itemId) => updateServerItem(items, itemId, value),
      },
      () => [],
      (_signals, itemId) => ({
        queryKey: playgroundServerKeys.item(itemId),
        queryFn: ({ signal }) => api.item(itemId, signal),
      }),
      (query) => toServerResult<ServerItem>(query),
    );

    // 3. The region subscription is sampled as a passive signal. Changing it
    // makes the query extension switch to a different TanStack key and observer.
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.serverRegionSummary,
      {
        stateKey: stateKeys.serverRegionSummary,
        update: (_current, value) => value,
      },
      () => [[appIds.subscriptions.serverRegion]],
      ([region]) => ({
        queryKey: playgroundServerKeys.region(region),
        queryFn: ({ signal }) => api.region(region, signal),
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

function serverResultsEqual<TData>(
  previous: ServerQueryResult<TData> | undefined,
  next: ServerQueryResult<TData>,
): boolean {
  if (previous === undefined || previous.kind !== next.kind) return false;
  if (previous.kind === 'loading') return true;
  if (previous.kind === 'error' && next.kind === 'error') {
    return previous.message === next.message;
  }
  return previous.kind === 'ready' && next.kind === 'ready' && Object.is(previous.data, next.data);
}

function updateServerItem(
  items: ServerItems,
  itemId: number,
  value: ServerQueryResult<ServerItem>,
): ServerItems {
  if (serverResultsEqual(items[itemId], value)) return items;
  return { ...items, [itemId]: value };
}
