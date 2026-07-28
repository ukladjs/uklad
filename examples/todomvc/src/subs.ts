import { setupSubsHotReload } from '@flexsurfer/reflex/react';

import { SUB_IDS } from './sub-ids';
import { todoRuntime } from './runtime';

// `todoRuntime` carries TodoContracts, so every dependency value below is
// inferred from the dependency list — no parameter annotations, and a
// reordered dependency list is a compile error rather than a silent swap.
todoRuntime.registerModule((registrar) => {
  registrar.regRootSub(SUB_IDS.TODOS, 'todos');
  registrar.regRootSub(SUB_IDS.SHOWING, SUB_IDS.SHOWING);

  registrar.regSub(
    SUB_IDS.VISIBLE_TODOS,
    () => [[SUB_IDS.TODOS], [SUB_IDS.SHOWING]],
    ([todos, showing]) => {
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
  );

  registrar.regSub(
    SUB_IDS.ALL_COMPLETE,
    () => [[SUB_IDS.TODOS]],
    ([todos]) => {
      const todosArray = Array.from(todos.values());
      return todosArray.length > 0 && todosArray.every((todo) => todo.done);
    },
  );

  registrar.regSub(
    SUB_IDS.FOOTER_COUNTS,
    () => [[SUB_IDS.TODOS]],
    ([todos]) => {
      const todosArray = Array.from(todos.values());
      const active = todosArray.filter((todo) => !todo.done).length;
      const done = todosArray.filter((todo) => todo.done).length;
      // Declared as a pair so it matches the contract; `[active, done]` alone
      // would widen to number[], which callers cannot destructure safely.
      const counts: [active: number, done: number] = [active, done];
      return counts;
    },
  );
});

if (import.meta.hot) {
  // Clear only this module's definitions. The persistence status subscription
  // and other feature-owned subscriptions remain registered across HMR.
  const { dispose, accept } = setupSubsHotReload(todoRuntime, Object.values(SUB_IDS));
  import.meta.hot.dispose(dispose);
  import.meta.hot.accept(accept);
}
