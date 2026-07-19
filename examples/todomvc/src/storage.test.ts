import { createReflexRuntime, enableMapSet } from '@flexsurfer/reflex';
import { persist } from '@flexsurfer/reflex-persist';
import type { SyncPersistStorage } from '@flexsurfer/reflex-persist';
import { describe, expect, it } from 'vitest';

import type { Todo, Todos } from './db';

enableMapSet();

describe('TodoMVC persistence integration', () => {
  it('preloads, hydrates before use, writes one Map root, and restores it on reload', async () => {
    const data = new Map([
      [
        'reflex/todos',
        JSON.stringify({
          v: 1,
          data: [[1, { id: 1, title: 'stored', done: false }]],
        }),
      ],
    ]);
    let writes = 0;
    const storage: SyncPersistStorage = {
      sync: true,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        writes += 1;
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    const keyConfig = {
      key: 'todos' as const,
      serialize: (todos: Todos) =>
        Array.from(todos.entries(), ([id, todo]) => [
          id,
          { id: todo.id, title: todo.title, done: todo.done },
        ]),
      deserialize: (stored: unknown) => new Map(stored as [number, Todo][]),
    };

    const firstRuntime = createReflexRuntime({ initialDb: { todos: new Map() as Todos } });
    const first = persist(firstRuntime, { storage, keys: [keyConfig] });
    firstRuntime.regEvent('todos/add', ({ draftDb }, todo: Todo) => {
      draftDb.todos.set(todo.id, todo);
    });

    first.hydrate();
    expect(firstRuntime.getAppDb().todos.get(1)?.title).toBe('stored');

    firstRuntime.dispatch(['todos/add', { id: 2, title: 'new', done: false }]);
    await firstRuntime.flush();
    expect(writes).toBe(1);
    first.dispose();
    firstRuntime.dispose();

    const reloadRuntime = createReflexRuntime({ initialDb: { todos: new Map() as Todos } });
    const reload = persist(reloadRuntime, { storage, keys: [keyConfig] });
    reload.hydrate();

    expect(writes).toBe(1);
    expect(reloadRuntime.getAppDb().todos).toBeInstanceOf(Map);
    expect(Array.from(reloadRuntime.getAppDb().todos.values())).toEqual([
      { id: 1, title: 'stored', done: false },
      { id: 2, title: 'new', done: false },
    ]);
    reload.dispose();
    reloadRuntime.dispose();
  });
});
