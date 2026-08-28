import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUkladRuntimeForTests } from '@ukladjs/core/internal';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import type { UkladTestHarness } from '@ukladjs/core/testing';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { createAppState } from '../../app/uklad/initial-state';
import { registerFeatureModules } from '../../app/uklad/register';
import type { Todo, TodosQueryResult } from '../../features/todos/state';
import { createWebQueryClient, todoKeys } from '../web/effects';
import type { TodosApi } from '../web/todos-api';
import { installTestEffects } from './effects';

const seededTodos: readonly Todo[] = [
  { id: 1, title: 'Active', done: false },
  { id: 2, title: 'Completed', done: true },
  { id: 3, title: 'Another active', done: false },
];

let runtime: UkladRuntime<AppContracts> & {
  getState(): AppContracts['state'];
  getStateRevisions(): { readonly committedRevision: number; readonly publishedRevision: number };
};
let harness: UkladTestHarness<AppContracts>;
let disposeEffects: UkladDisposer;
let queryClient: ReturnType<typeof createWebQueryClient>;
let api: TodosApi;
let stopObserving: UkladDisposer = () => {};

beforeEach(() => {
  queryClient = createWebQueryClient();
  queryClient.setQueryData(todoKeys.list(), seededTodos);
  api = createFakeApi();
  runtime = createUkladRuntimeForTests<AppContracts>({
    initialState: createAppState(),
    runtimeId: 'todomvc-query-test',
  });
  registerFeatureModules(runtime);
  disposeEffects = installTestEffects(runtime, queryClient, api);
  harness = createUkladTestHarness(runtime);
});

afterEach(() => {
  stopObserving();
  stopObserving = () => {};
  disposeEffects();
  runtime.dispose();
  queryClient.clear();
});

describe('TodoMVC query platform integration', () => {
  it('returns hydrated data on the first read without activating an observer or changing state', () => {
    const beforeRead = runtime.getStateRevisions();

    expect(todoObserverCount()).toBe(0);
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosQuery])).toEqual({
      kind: 'ready',
      todos: seededTodos,
    });
    expect(runtime.getState()).toEqual({ todosShowing: 'all' });
    expect(runtime.getStateRevisions()).toEqual(beforeRead);
    expect(api.list).not.toHaveBeenCalled();
    expect(todoObserverCount()).toBe(0);

    stopObserving = harness.watchSubscription([appIds.subscriptions.todosQuery], () => {});
    expect(todoObserverCount()).toBe(1);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('projects the external query into a clean read model and derives filters from it', () => {
    stopObserving = harness.watchSubscription([appIds.subscriptions.todosQuery], () => {});

    expect(harness.getSubscriptionValue([appIds.subscriptions.todosQuery])).toEqual({
      kind: 'ready',
      todos: seededTodos,
    });
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosVisible])).toEqual(seededTodos);
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosFooterCounts])).toEqual([2, 1]);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);

    harness.dispatchSync([appIds.events.todosSetShowing, 'active']);
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosVisible])).toEqual([
      seededTodos[0],
      seededTodos[2],
    ]);

    harness.dispatchSync([appIds.events.todosSetShowing, 'done']);
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosVisible])).toEqual([
      seededTodos[1],
    ]);
  });

  it('updates the rendered query value without creating an application-state revision', async () => {
    const fetchedTodos: readonly Todo[] = [
      { id: 4, title: 'Fetched', done: false },
    ];
    vi.mocked(api.list).mockResolvedValue(fetchedTodos);
    queryClient.removeQueries({ queryKey: todoKeys.list() });

    const renderedValues: TodosQueryResult[] = [];
    stopObserving = harness.watchSubscription(
      [appIds.subscriptions.todosQuery],
      (value) => renderedValues.push(value),
    );
    const beforeFetch = runtime.getStateRevisions();

    await waitForQueryState();

    expect(api.list).toHaveBeenCalledTimes(1);
    expect(harness.getSubscriptionValue([appIds.subscriptions.todosQuery])).toEqual({
      kind: 'ready',
      todos: fetchedTodos,
    });
    expect(renderedValues.at(-1)).toEqual({ kind: 'ready', todos: fetchedTodos });
    expect(runtime.getStateRevisions()).toEqual(beforeFetch);
    expect(runtime.getState()).toEqual({ todosShowing: 'all' });
  });

  it('injects the cache-owned list into an event without exposing query state', async () => {
    harness.dispatchSync([appIds.events.todosClearCompleted]);
    await waitForQueryState();
    expect(api.clearCompleted).toHaveBeenCalledTimes(1);

    queryClient.setQueryData(
      todoKeys.list(),
      seededTodos.filter((todo) => !todo.done),
    );
    harness.dispatchSync([appIds.events.todosClearCompleted]);
    await waitForQueryState();

    expect(api.clearCompleted).toHaveBeenCalledTimes(1);
    expect(runtime.getState()).toEqual({ todosShowing: 'all' });
  });
});

async function waitForQueryState(): Promise<void> {
  for (let index = 0; index < 5; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await harness.flush();
  }
}

function todoObserverCount(): number {
  return (
    queryClient
      .getQueryCache()
      .find({ queryKey: todoKeys.list() })
      ?.getObserversCount() ?? 0
  );
}

function createFakeApi(): TodosApi {
  return {
    list: vi.fn(async () => seededTodos),
    create: vi.fn(async (title: string) => ({ id: 4, title, done: false })),
    update: vi.fn(async (id: number) => ({ id, title: 'Updated', done: false })),
    remove: vi.fn(async () => undefined),
    completeAll: vi.fn(async () => undefined),
    clearCompleted: vi.fn(async () => undefined),
  };
}
