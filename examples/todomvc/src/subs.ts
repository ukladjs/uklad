import { setupSubsHotReload } from '@flexsurfer/reflex';

import type { Showing, Todos } from './state';
import { SUB_IDS } from './sub-ids';
import { todoRuntime } from './runtime';

todoRuntime.registerModule((registrar) => {
  registrar.regRootSub(SUB_IDS.TODOS, 'todos');
  registrar.regRootSub(SUB_IDS.SHOWING, SUB_IDS.SHOWING);

  registrar.regSub(
    SUB_IDS.VISIBLE_TODOS,
    (todos: Todos, showing: Showing) => {
      if (!todos) return [];
      const todosArray = Array.from(todos.values());
      switch (showing) {
        case 'active':
          return todosArray.filter((todo) => !todo.done);
        case 'done':
          return todosArray.filter((todo) => todo.done);
        default:
          return todosArray;
      }
    },
    () => [[SUB_IDS.TODOS], [SUB_IDS.SHOWING]],
  );

  registrar.regSub(
    SUB_IDS.ALL_COMPLETE,
    (todos: Todos) => {
      const todosArray = Array.from(todos.values());
      return todosArray.length > 0 && todosArray.every((todo) => todo.done);
    },
    () => [[SUB_IDS.TODOS]],
  );

  registrar.regSub(
    SUB_IDS.FOOTER_COUNTS,
    (todos: Todos) => {
      const todosArray = Array.from(todos.values());
      const active = todosArray.filter((todo) => !todo.done).length;
      const done = todosArray.filter((todo) => todo.done).length;
      return [active, done];
    },
    () => [[SUB_IDS.TODOS]],
  );
});

if (import.meta.hot) {
  // Clear only this module's definitions. The persistence status subscription
  // and other feature-owned subscriptions remain registered across HMR.
  const { dispose, accept } = setupSubsHotReload(todoRuntime, Object.values(SUB_IDS));
  import.meta.hot.dispose(dispose);
  import.meta.hot.accept(accept);
}
