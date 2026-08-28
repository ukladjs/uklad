import { MutationObserver } from '@tanstack/query-core';
import type { MutationKey } from '@tanstack/query-core';
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
import type { Todo, TodosQueryResult } from '../../features/todos/state';
import type { TodosApi } from './todos-api';

/** The one TanStack cache key for this small, client-filtered collection. */
export const todoKeys = {
  all: ['todos'] as const,
  list: () => [...todoKeys.all, 'list'] as const,
} as const;

const todoMutationKeys = {
  create: () => [...todoKeys.all, 'create'] as const,
  update: () => [...todoKeys.all, 'update'] as const,
  remove: () => [...todoKeys.all, 'remove'] as const,
  completeAll: () => [...todoKeys.all, 'complete-all'] as const,
  clearCompleted: () => [...todoKeys.all, 'clear-completed'] as const,
} as const;

const LOADING_TODOS_QUERY: TodosQueryResult = Object.freeze({ kind: 'loading' });

/** Platform-owned TanStack client policy. */
export function createWebQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

/**
 * Register browser-backed external work for the Todo feature.
 *
 * `regQuerySub` belongs here with the mutations: both bind Uklad to
 * the selected platform's QueryClient and TodosApi, while the feature retains
 * only pure commands and derived subscriptions.
 */
export function createWebEffects(
  queryClient: QueryClient,
  api: TodosApi,
): UkladModule<UkladRegistrar<AppContracts>> {
  return (registrar) => {
    regQuerySub(
      registrar,
      queryClient,
      appIds.subscriptions.todosQuery,
      () => [],
      () => ({
        queryKey: todoKeys.list(),
        queryFn: () => api.list(),
        staleTime: 30_000,
      }),
      toTodosQueryResult,
    );

    registrar.regEffect(appIds.effects.todosCreate, ({ title }) => {
      runTodoMutation(queryClient, todoMutationKeys.create(), api.create, title);
    });
    registrar.regEffect(appIds.effects.todosUpdate, ({ id, title, done }) => {
      runTodoMutation(
        queryClient,
        todoMutationKeys.update(),
        (variables) => api.update(variables.id, variables.patch),
        {
          id,
          patch: {
            ...(title === undefined ? {} : { title }),
            ...(done === undefined ? {} : { done }),
          },
        },
      );
    });
    registrar.regEffect(appIds.effects.todosDelete, (id) => {
      runTodoMutation(queryClient, todoMutationKeys.remove(), api.remove, id);
    });
    registrar.regEffect(appIds.effects.todosCompleteAll, ({ done }) => {
      runTodoMutation(queryClient, todoMutationKeys.completeAll(), api.completeAll, done);
    });
    registrar.regEffect(appIds.effects.todosClearCompleted, () => {
      runTodoMutation(
        queryClient,
        todoMutationKeys.clearCompleted(),
        api.clearCompleted,
        undefined,
      );
    });
    registrar.regEffect(appIds.effects.todosRefresh, () => {
      void queryClient.invalidateQueries({ queryKey: todoKeys.all });
    });
  };
}

/** Mount one browser QueryClient and its matching platform registrations. */
export function installWebEffects(
  runtime: UkladRuntime<AppContracts>,
  queryClient: QueryClient,
  api: TodosApi,
): UkladDisposer {
  const detachQueryClient = attachQueryClient(runtime, queryClient, {
    cacheCoeffects: [
      {
        id: appIds.coeffects.todosCachedList,
        read: (cache) => cache.getData<readonly Todo[]>(todoKeys.list()),
      },
    ],
  });
  const disposeModule = runtime.registerModule(createWebEffects(queryClient, api));
  return () => {
    disposeModule();
    detachQueryClient();
  };
}

function runTodoMutation<TVariables, TData>(
  queryClient: QueryClient,
  mutationKey: MutationKey,
  mutationFn: (variables: TVariables) => Promise<TData>,
  variables: TVariables,
): void {
  const observer = new MutationObserver<TData, Error, TVariables>(queryClient, {
    mutationKey,
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.all }),
  });
  void observer.mutate(variables).catch((error: unknown) => {
    console.error('[todomvc-query] Todo mutation failed:', error);
  });
}

function toTodosQueryResult(query: QuerySnapshot<readonly Todo[]>): TodosQueryResult {
  if (query.error !== null) return { kind: 'error', message: query.error.message };
  if (query.data === undefined) return LOADING_TODOS_QUERY;
  return { kind: 'ready', todos: query.data };
}
