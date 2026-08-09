import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import type { UkladTestHarness } from '@ukladjs/core/testing';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { registerFeatureModules } from '../../app/uklad/register';
import { createAppRuntime } from '../../app/uklad/runtime';
import type { Todo } from '../../features/todos/state';
import { createWebQueryClient, todoKeys } from '../web/effects';
import type { TodosApi } from '../web/todos-api';
import { installTestEffects } from './effects';

const seededTodos: readonly Todo[] = [
  { id: 1, title: 'Active', done: false },
  { id: 2, title: 'Completed', done: true },
  { id: 3, title: 'Another active', done: false },
];

let runtime: UkladRuntime<AppContracts>;
let harness: UkladTestHarness<AppContracts>;
let disposeEffects: UkladDisposer;
let queryClient: ReturnType<typeof createWebQueryClient>;
let stopObserving: UkladDisposer;

beforeEach(async () => {
  queryClient = createWebQueryClient();
  queryClient.setQueryData(todoKeys.list(), seededTodos);
  runtime = createAppRuntime();
  registerFeatureModules(runtime);
  disposeEffects = installTestEffects(runtime, queryClient, createFakeApi());
  harness = createUkladTestHarness(runtime);
  stopObserving = harness.watchSubscription([appIds.subscriptions.todosQuery], () => {});
  await waitForQueryState();
});

afterEach(() => {
  stopObserving();
  disposeEffects();
  runtime.dispose();
  queryClient.clear();
});

describe('TodoMVC query platform integration', () => {
  it('projects TanStack data into a clean Todo read model and derives filters from it', () => {
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
});

async function waitForQueryState(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 24));
  await harness.flush();
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
