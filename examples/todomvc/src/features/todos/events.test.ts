import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import type { ReflexTestHarness } from '@flexsurfer/reflex/testing';

import { appIds } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';
import { registerFeatureModules } from '../../app/reflex/register';
import { createAppRuntime } from '../../app/reflex/runtime';
import { createTestClock } from '../../platform/test/coeffects';
import type { TestClock } from '../../platform/test/coeffects';
import type { Todo, TodoId } from './state';

enableMapSet();

// Each test owns an isolated runtime with the shipped feature modules and the
// test platform adapters — nothing here resets shared process-global state.
// Persistence is contributed by a separate module (see platform/web), so these
// handlers only mutate the draft and return no storage effects.

let runtime: ReflexRuntime<AppContracts>;
let harness: ReflexTestHarness<AppContracts>;
let clock: TestClock;

const todos = (): Map<TodoId, Todo> => harness.getState().todosById;

beforeEach(() => {
  runtime = createAppRuntime({ runtimeId: 'todomvc.test' });
  registerFeatureModules(runtime);
  clock = createTestClock(12_345);
  runtime.registerModule(clock.module);
  harness = createReflexTestHarness(runtime);
});

afterEach(() => {
  runtime.dispose();
});

describe('todos/add', () => {
  it('adds a todo keyed by the injected clock', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'New Todo']);

    expect(todos().size).toBe(1);
    expect(todos().get(12_345)).toEqual({ id: 12_345, title: 'New Todo', done: false });
  });

  it('trims whitespace from the title', () => {
    harness.dispatchSync([appIds.events.todosAdd, '  Trimmed Todo  ']);

    expect(todos().get(12_345)?.title).toBe('Trimmed Todo');
  });

  it('touches no other state root', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'New Todo']);

    expect(Object.keys(harness.getState())).toEqual(['todosById', 'todosShowing']);
    expect(harness.getState().todosShowing).toBe('all');
  });
});

describe('todos/toggle-done', () => {
  it('toggles completion', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Test Todo']);
    harness.dispatchSync([appIds.events.todosToggleDone, 12_345]);

    expect(todos().get(12_345)?.done).toBe(true);

    harness.dispatchSync([appIds.events.todosToggleDone, 12_345]);
    expect(todos().get(12_345)?.done).toBe(false);
  });

  it('handles a non-existent todo gracefully', () => {
    expect(() => harness.dispatchSync([appIds.events.todosToggleDone, 999])).not.toThrow();
    expect(todos().size).toBe(0);
  });
});

describe('todos/delete', () => {
  it('removes only the named todo', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 1']);
    clock.set(2);
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 2']);

    harness.dispatchSync([appIds.events.todosDelete, 12_345]);

    expect(todos().has(12_345)).toBe(false);
    expect(todos().has(2)).toBe(true);
  });
});

describe('todos/save', () => {
  it('trims whitespace from the new title', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Original']);
    harness.dispatchSync([appIds.events.todosSave, 12_345, '  Spaced Title  ']);

    expect(todos().get(12_345)?.title).toBe('Spaced Title');
  });
});

describe('todos/complete-all-toggle', () => {
  it('marks all complete when some are incomplete', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 1']);
    clock.set(2);
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 2']);
    harness.dispatchSync([appIds.events.todosToggleDone, 2]);

    harness.dispatchSync([appIds.events.todosCompleteAllToggle]);

    expect(Array.from(todos().values()).every((todo) => todo.done)).toBe(true);
  });

  it('marks all incomplete when every todo is complete', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 1']);
    clock.set(2);
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 2']);
    harness.dispatchSync([appIds.events.todosCompleteAllToggle]);

    harness.dispatchSync([appIds.events.todosCompleteAllToggle]);

    expect(Array.from(todos().values()).some((todo) => todo.done)).toBe(false);
  });
});

describe('todos/clear-completed', () => {
  it('removes only completed todos', () => {
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 1']);
    clock.set(2);
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 2']);
    clock.set(3);
    harness.dispatchSync([appIds.events.todosAdd, 'Todo 3']);
    harness.dispatchSync([appIds.events.todosToggleDone, 12_345]);
    harness.dispatchSync([appIds.events.todosToggleDone, 3]);

    harness.dispatchSync([appIds.events.todosClearCompleted]);

    expect(todos().size).toBe(1);
    expect(todos().has(2)).toBe(true);
  });
});

describe('todos/set-showing', () => {
  it('updates the filter root without touching the todos root', () => {
    const before = todos();

    harness.dispatchSync([appIds.events.todosSetShowing, 'active']);

    expect(harness.getState().todosShowing).toBe('active');
    // Independent roots: changing the filter leaves the todo root's identity
    // untouched, so the subscription graph rooted at `todosById` is not redone.
    expect(harness.getState().todosById).toBe(before);
  });

  it('accepts every filter value', () => {
    harness.dispatchSync([appIds.events.todosSetShowing, 'done']);
    expect(harness.getState().todosShowing).toBe('done');

    harness.dispatchSync([appIds.events.todosSetShowing, 'all']);
    expect(harness.getState().todosShowing).toBe('all');
  });
});
