import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import type { Todo, TodoId, TodosById } from './state';

/**
 * Pure state transitions for the `todos` feature.
 *
 * Handlers mutate the Immer draft and return effect intents; they never touch
 * the environment. Persistence is contributed by the storage module, so no
 * handler here mentions localStorage.
 */
export const registerTodosEvents: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEvent(
    appIds.events.todosAdd,
    ({ draftState, coeffects: { now } }, title) => {
      // The injected clock keeps ID creation deterministic and testable: the
      // web runtime binds it to Date.now(), a test runtime to a fixed value.
      const newTodo: Todo = {
        id: now,
        title: title.trim(),
        done: false,
      };

      draftState.todosById.set(newTodo.id, newTodo);
    },
    { coeffects: { now: appIds.coeffects.systemNow } },
  );

  registrar.regEvent(appIds.events.todosToggleDone, ({ draftState }, id) => {
    const todo = draftState.todosById.get(id);
    if (todo) {
      todo.done = !todo.done;
    }
  });

  registrar.regEvent(appIds.events.todosDelete, ({ draftState }, id) => {
    draftState.todosById.delete(id);
  });

  registrar.regEvent(appIds.events.todosSave, ({ draftState }, id, newTitle) => {
    const todo = draftState.todosById.get(id);
    if (todo) {
      todo.title = newTitle.trim();
    }
  });

  registrar.regEvent(appIds.events.todosCompleteAllToggle, ({ draftState }) => {
    const todos = Array.from((draftState.todosById as TodosById).values()) as Todo[];
    const allComplete = todos.length > 0 && todos.every((todo) => todo.done);

    todos.forEach((todo) => {
      todo.done = !allComplete;
    });
  });

  registrar.regEvent(appIds.events.todosClearCompleted, ({ draftState }) => {
    const entries = Array.from((draftState.todosById as TodosById).entries()) as [TodoId, Todo][];
    entries.forEach(([id, todo]) => {
      if (todo.done) {
        draftState.todosById.delete(id);
      }
    });
  });

  registrar.regEvent(appIds.events.todosSetShowing, ({ draftState }, showing) => {
    draftState.todosShowing = showing;
  });
};
