import { localStorageAdapter, persist } from '@ukladjs/persist';
import type { PersistHandle, SyncPersistStorage } from '@ukladjs/persist';
import type { UkladRuntime } from '@ukladjs/core/vanilla';

import { stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import type { Todo, TodoId, TodosById } from '../../features/todos/state';

/**
 * How the `todosById` root crosses the storage boundary.
 *
 * JSON has no Map, so the root is stored as an entry-tuple array and rebuilt on
 * hydration. Exported so a test can drive the same configuration against a fake
 * storage.
 */
export const todosKeyConfig = {
  key: stateKeys.todosById,
  serialize: (todosById: TodosById) =>
    Array.from(todosById.entries(), ([id, todo]) => [
      id,
      { id: todo.id, title: todo.title, done: todo.done },
    ]),
  deserialize: (data: unknown) => new Map(data as [TodoId, Todo][]),
};

/**
 * Attach persistence to one runtime.
 *
 * Hydration is an event, and the writer contributes a post-commit effect to
 * whichever domain event changed `todosById`, so no event handler in
 * `features/todos` mentions storage. The entry point hydrates before the first
 * render.
 */
export function registerWebPersistence(
  runtime: UkladRuntime<AppContracts>,
  storage: SyncPersistStorage = localStorageAdapter(),
): PersistHandle {
  return persist(runtime, { storage, keys: [todosKeyConfig] });
}
