import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/** Pure read model derived from the feature's ordinary Uklad roots. */
export const registerTodosSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.todosShowing, stateKeys.todosShowing);
  registrar.regRootSub(appIds.subscriptions.todosQuery, stateKeys.todosQuery);

  registrar.regSub(
    appIds.subscriptions.todosVisible,
    () => [
      [appIds.subscriptions.todosQuery],
      [appIds.subscriptions.todosShowing],
    ],
    ([query, showing]) => {
      const todos = query.kind === 'ready' ? query.todos : [];
      switch (showing) {
        case 'active':
          return todos.filter((todo) => !todo.done);
        case 'done':
          return todos.filter((todo) => todo.done);
        default:
          return [...todos];
      }
    },
  );

  registrar.regSub(
    appIds.subscriptions.todosAllComplete,
    () => [[appIds.subscriptions.todosQuery]],
    ([query]) => {
      const todos = query.kind === 'ready' ? query.todos : [];
      return todos.length > 0 && todos.every((todo) => todo.done);
    },
  );

  registrar.regSub(
    appIds.subscriptions.todosFooterCounts,
    () => [[appIds.subscriptions.todosQuery]],
    ([query]) => {
      const todos = query.kind === 'ready' ? query.todos : [];
      const active = todos.filter((todo) => !todo.done).length;
      const counts: [active: number, done: number] = [active, todos.length - active];
      return counts;
    },
  );
};
