import type { Showing, Todo, TodoId, Todos } from './state';
import { EVENT_IDS } from './event-ids';
import { todoRuntime } from './runtime';

const disposeEvents = todoRuntime.registerModule((registrar) => {
  registrar.regEvent(
    EVENT_IDS.ADD_TODO,
    ({ draftState, now }, title: string) => {
      // The injected clock keeps ID creation deterministic and testable.
      const newTodo: Todo = {
        id: now,
        title: title.trim(),
        done: false,
      };

      draftState.todos.set(newTodo.id, newTodo);
    },
    { coeffects: [['now']] },
  );

  registrar.regEvent(EVENT_IDS.TOGGLE_DONE, ({ draftState }, id: TodoId) => {
    const todo = draftState.todos.get(id);
    if (todo) {
      todo.done = !todo.done;
    }
  });

  registrar.regEvent(EVENT_IDS.DELETE_TODO, ({ draftState }, id: TodoId) => {
    draftState.todos.delete(id);
  });

  registrar.regEvent(EVENT_IDS.SAVE, ({ draftState }, id: TodoId, newTitle: string) => {
    const todo = draftState.todos.get(id);
    if (todo) {
      todo.title = newTitle.trim() + 'event2';
    }
  });

  registrar.regEvent(EVENT_IDS.COMPLETE_ALL_TOGGLE, ({ draftState }) => {
    const todosArray = Array.from((draftState.todos as Todos).values()) as Todo[];
    const allComplete = todosArray.length > 0 && todosArray.every((todo) => todo.done);

    todosArray.forEach((todo) => {
      todo.done = !allComplete;
    });
  });

  registrar.regEvent(EVENT_IDS.CLEAR_COMPLETED, ({ draftState }) => {
    const todosArray = Array.from((draftState.todos as Todos).entries()) as [TodoId, Todo][];
    todosArray.forEach(([id, todo]) => {
      if (todo.done) {
        draftState.todos.delete(id);
      }
    });
  });

  registrar.regEvent(EVENT_IDS.SET_SHOWING, ({ draftState }, showing: Showing) => {
    draftState.showing = showing;
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
