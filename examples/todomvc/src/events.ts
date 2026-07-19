import { defaultRuntime, NOW } from '@flexsurfer/reflex';

import type { Showing, Todo, TodoId, Todos } from './db';
import { EVENT_IDS } from './event-ids';

const disposeEvents = defaultRuntime.registerModule((scope) => {
  scope.regEvent(
    EVENT_IDS.ADD_TODO,
    ({ draftDb, now }, title: string) => {
      // The injected clock keeps ID creation deterministic and testable.
      const newTodo: Todo = {
        id: now,
        title: title.trim(),
        done: false,
      };

      draftDb.todos.set(newTodo.id, newTodo);
    },
    { coeffects: [[NOW]] },
  );

  scope.regEvent(EVENT_IDS.TOGGLE_DONE, ({ draftDb }, id: TodoId) => {
    const todo = draftDb.todos.get(id);
    if (todo) {
      todo.done = !todo.done;
    }
  });

  scope.regEvent(EVENT_IDS.DELETE_TODO, ({ draftDb }, id: TodoId) => {
    draftDb.todos.delete(id);
  });

  scope.regEvent(EVENT_IDS.SAVE, ({ draftDb }, id: TodoId, newTitle: string) => {
    const todo = draftDb.todos.get(id);
    if (todo) {
      todo.title = newTitle.trim() + 'event2';
    }
  });

  scope.regEvent(EVENT_IDS.COMPLETE_ALL_TOGGLE, ({ draftDb }) => {
    const todosArray = Array.from((draftDb.todos as Todos).values()) as Todo[];
    const allComplete = todosArray.length > 0 && todosArray.every((todo) => todo.done);

    todosArray.forEach((todo) => {
      todo.done = !allComplete;
    });
  });

  scope.regEvent(EVENT_IDS.CLEAR_COMPLETED, ({ draftDb }) => {
    const todosArray = Array.from((draftDb.todos as Todos).entries()) as [TodoId, Todo][];
    todosArray.forEach(([id, todo]) => {
      if (todo.done) {
        draftDb.todos.delete(id);
      }
    });
  });

  scope.regEvent(EVENT_IDS.SET_SHOWING, ({ draftDb }, showing: Showing) => {
    draftDb.showing = showing;
  });
});

if (import.meta.hot) {
  // Remove only this module's handlers. Persistence and unrelated feature
  // registrations remain installed across the replacement.
  import.meta.hot.dispose(disposeEvents);

  import.meta.hot.accept((newModule) => {
    if (newModule) {
      console.log('updated: new events module');
    }
  });
}
