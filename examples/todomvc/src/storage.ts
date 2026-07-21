import { localStorageAdapter, persist } from '@flexsurfer/reflex-persist';

import type { Todo, TodoId, Todos } from './db';
import { todoRuntime } from './runtime';

// Hydration is an event and the global writer contributes a post-commit effect
// to whichever domain event changed `todos`; event handlers never mention
// storage. main.tsx hydrates synchronously before the first render.
export const persistence = persist(todoRuntime, {
  storage: localStorageAdapter(),
  keys: [
    {
      key: 'todos',
      // JSON does not preserve Map entries, so persist an entry tuple array.
      serialize: (todos) =>
        Array.from((todos as Todos).entries(), ([id, todo]) => [
          id,
          { id: todo.id, title: todo.title, done: todo.done },
        ]),
      deserialize: (data) => new Map(data as [TodoId, Todo][]),
    },
  ],
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => persistence.dispose());
}
