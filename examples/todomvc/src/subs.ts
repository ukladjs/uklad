import { regSub, setupSubsHotReload } from '@lib/index';

import type { Showing, Todos } from './db';
import { SUB_IDS } from './sub-ids';

regSub(SUB_IDS.TODOS, 'todos');
regSub(SUB_IDS.SHOWING);

regSub(
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

regSub(
  SUB_IDS.ALL_COMPLETE,
  (todos: Todos) => {
    const todosArray = Array.from(todos.values());
    return todosArray.length > 0 && todosArray.every((todo) => todo.done);
  },
  () => [[SUB_IDS.TODOS]],
);

regSub(
  SUB_IDS.FOOTER_COUNTS,
  (todos: Todos) => {
    const todosArray = Array.from(todos.values());
    const active = todosArray.filter((todo) => !todo.done).length;
    const done = todosArray.filter((todo) => todo.done).length;
    return [active, done];
  },
  () => [[SUB_IDS.TODOS]],
);

if (import.meta.hot) {
  const { dispose, accept } = setupSubsHotReload();
  import.meta.hot.dispose(dispose);
  import.meta.hot.accept(accept);
}
