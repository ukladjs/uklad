import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/**
 * The `todos` reactive graph.
 *
 * `regRootSub` is the explicit mapping between the query surface and the state
 * shape: the first argument is the subscription id components query, the second
 * is the state property event handlers write. Computed subscriptions then
 * depend only on subscription ids — never on state keys — so the storage shape
 * stays free to change behind them.
 *
 * The registrar carries `AppContracts`, so every dependency value below is
 * inferred from the dependency list: no parameter annotations, and a reordered
 * dependency list is a compile error rather than a silent argument swap.
 */
export const registerTodosSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.todosById, stateKeys.todosById);
  registrar.regRootSub(appIds.subscriptions.todosShowing, stateKeys.todosShowing);

  registrar.regSub(
    appIds.subscriptions.todosVisible,
    () => [[appIds.subscriptions.todosById], [appIds.subscriptions.todosShowing]],
    ([todosById, showing]) => {
      const todos = Array.from(todosById.values());
      switch (showing) {
        case 'active':
          return todos.filter((todo) => !todo.done);
        case 'done':
          return todos.filter((todo) => todo.done);
        default:
          return todos;
      }
    },
  );

  registrar.regSub(
    appIds.subscriptions.todosAllComplete,
    () => [[appIds.subscriptions.todosById]],
    ([todosById]) => {
      const todos = Array.from(todosById.values());
      return todos.length > 0 && todos.every((todo) => todo.done);
    },
  );

  registrar.regSub(
    appIds.subscriptions.todosFooterCounts,
    () => [[appIds.subscriptions.todosById]],
    ([todosById]) => {
      const todos = Array.from(todosById.values());
      const active = todos.filter((todo) => !todo.done).length;
      const done = todos.filter((todo) => todo.done).length;
      // Declared as a pair so it matches the contract; `[active, done]` alone
      // would widen to number[], which callers cannot destructure safely.
      const counts: [active: number, done: number] = [active, done];
      return counts;
    },
  );
};
