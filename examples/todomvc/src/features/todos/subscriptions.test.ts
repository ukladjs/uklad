import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SubDepsHandler, SubHandler } from '@flexsurfer/reflex';
import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import type { ReflexTestHarness } from '@flexsurfer/reflex/testing';

import { appIds } from '../../app/reflex/catalog';
import type { AppContracts, AppState } from '../../app/reflex/contracts';
import { registerFeatureModules } from '../../app/reflex/register';
import { createAppRuntime } from '../../app/reflex/runtime';
import type { TodosById } from './state';

enableMapSet();

// Subscriptions are pure functions of their dependency values, so a computed
// subscription can be called directly with the values its dependency list
// would have produced. Root subscriptions read the state, so those are driven
// through the harness instead.

let runtime: ReflexRuntime<AppContracts>;
let harness: ReflexTestHarness<AppContracts>;

const handlerFor = (id: string) => harness.getSubscriptionHandler(id as never) as SubHandler;

const stateWith = (todosById: TodosById, todosShowing: AppState['todosShowing']): AppState => ({
  todosById,
  todosShowing,
});

beforeEach(() => {
  runtime = createAppRuntime({ runtimeId: 'todomvc.test' });
  registerFeatureModules(runtime);
  harness = createReflexTestHarness(runtime);
});

afterEach(() => {
  runtime.dispose();
});

describe('root subscriptions', () => {
  it('todos/by-id reads the todosById root through', () => {
    const todosById: TodosById = new Map([
      [1, { id: 1, title: 'Todo 1', done: false }],
      [2, { id: 2, title: 'Todo 2', done: true }],
    ]);
    harness.restoreState(stateWith(todosById, 'all'));

    expect(handlerFor(appIds.subscriptions.todosById)()).toBe(todosById);
  });

  it('todos/by-id handles an empty root', () => {
    const todosById: TodosById = new Map();
    harness.restoreState(stateWith(todosById, 'all'));

    expect(handlerFor(appIds.subscriptions.todosById)()).toBe(todosById);
  });

  it('todos/showing reads every filter value through', () => {
    for (const showing of ['all', 'active', 'done'] as const) {
      harness.restoreState(stateWith(new Map(), showing));

      expect(handlerFor(appIds.subscriptions.todosShowing)()).toBe(showing);
    }
  });
});

describe('todos/visible', () => {
  const todosById: TodosById = new Map([
    [1, { id: 1, title: 'Todo 1', done: false }],
    [2, { id: 2, title: 'Todo 2', done: true }],
    [3, { id: 3, title: 'Todo 3', done: false }],
  ]);

  it('returns every todo when showing all', () => {
    const result = handlerFor(appIds.subscriptions.todosVisible)([todosById, 'all']);

    expect(result).toHaveLength(3);
  });

  it('returns only active todos when showing active', () => {
    const result = handlerFor(appIds.subscriptions.todosVisible)([todosById, 'active']);

    expect(result).toEqual([
      { id: 1, title: 'Todo 1', done: false },
      { id: 3, title: 'Todo 3', done: false },
    ]);
  });

  it('returns only done todos when showing done', () => {
    const result = handlerFor(appIds.subscriptions.todosVisible)([todosById, 'done']);

    expect(result).toEqual([{ id: 2, title: 'Todo 2', done: true }]);
  });

  it('returns an empty array for an empty root', () => {
    expect(handlerFor(appIds.subscriptions.todosVisible)([new Map(), 'all'])).toEqual([]);
  });

  it('depends on the todos and showing subscriptions, in that order', () => {
    const deps = (
      harness.getSubscriptionDependencies(appIds.subscriptions.todosVisible) as SubDepsHandler
    )();

    expect(deps).toEqual([
      [appIds.subscriptions.todosById],
      [appIds.subscriptions.todosShowing],
    ]);
  });
});

describe('todos/all-complete', () => {
  const handler = () => handlerFor(appIds.subscriptions.todosAllComplete);

  it('is true when every todo is done', () => {
    const todosById: TodosById = new Map([
      [1, { id: 1, title: 'Todo 1', done: true }],
      [2, { id: 2, title: 'Todo 2', done: true }],
    ]);

    expect(handler()([todosById])).toBe(true);
  });

  it('is false when any todo is active', () => {
    const todosById: TodosById = new Map([
      [1, { id: 1, title: 'Todo 1', done: true }],
      [2, { id: 2, title: 'Todo 2', done: false }],
    ]);

    expect(handler()([todosById])).toBe(false);
  });

  it('is false when there are no todos', () => {
    expect(handler()([new Map()])).toBe(false);
  });

  it('handles a single todo either way', () => {
    expect(handler()([new Map([[1, { id: 1, title: 'Single', done: true }]])])).toBe(true);
    expect(handler()([new Map([[1, { id: 1, title: 'Single', done: false }]])])).toBe(false);
  });

  it('depends only on the todos subscription', () => {
    const deps = (
      harness.getSubscriptionDependencies(appIds.subscriptions.todosAllComplete) as SubDepsHandler
    )();

    expect(deps).toEqual([[appIds.subscriptions.todosById]]);
  });
});

describe('todos/footer-counts', () => {
  const handler = () => handlerFor(appIds.subscriptions.todosFooterCounts);

  it('counts active and done todos', () => {
    const todosById: TodosById = new Map([
      [1, { id: 1, title: 'Todo 1', done: false }],
      [2, { id: 2, title: 'Todo 2', done: true }],
      [3, { id: 3, title: 'Todo 3', done: false }],
      [4, { id: 4, title: 'Todo 4', done: true }],
      [5, { id: 5, title: 'Todo 5', done: false }],
    ]);

    expect(handler()([todosById])).toEqual([3, 2]);
  });

  it('counts an all-active and an all-done root', () => {
    const active: TodosById = new Map([[1, { id: 1, title: 'Todo 1', done: false }]]);
    const done: TodosById = new Map([[1, { id: 1, title: 'Todo 1', done: true }]]);

    expect(handler()([active])).toEqual([1, 0]);
    expect(handler()([done])).toEqual([0, 1]);
  });

  it('counts an empty root as zero', () => {
    expect(handler()([new Map()])).toEqual([0, 0]);
  });

  it('depends only on the todos subscription', () => {
    const deps = (
      harness.getSubscriptionDependencies(appIds.subscriptions.todosFooterCounts) as SubDepsHandler
    )();

    expect(deps).toEqual([[appIds.subscriptions.todosById]]);
  });
});
