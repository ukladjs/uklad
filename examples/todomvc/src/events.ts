import { clearHandlers, current, regEvent } from '@flexsurfer/reflex';

import { COEFFECT_IDS } from './coeffect-ids';
import type { Showing, Todo, TodoId, Todos } from './db';
import { EFFECT_IDS } from './effect-ids';
import { EVENT_IDS } from './event-ids';

regEvent(
  EVENT_IDS.INIT_APP,
  ({ draftDb, localStoreTodos }) => {
    if (localStoreTodos && localStoreTodos.size > 0) {
      draftDb.todos = localStoreTodos;
    }
  },
  [[COEFFECT_IDS.LOCAL_STORE_TODOS]],
);

regEvent(
  EVENT_IDS.ADD_TODO,
  ({ draftDb, now }, title: string) => {
    // The injected clock keeps ID creation deterministic and testable.
    const newTodo: Todo = {
      id: now,
      title: title.trim(),
      done: false,
    };

    draftDb.todos.set(newTodo.id, newTodo);
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  },
  [[COEFFECT_IDS.NOW]],
);

regEvent(EVENT_IDS.TOGGLE_DONE, ({ draftDb }, id: TodoId) => {
  const todo = draftDb.todos.get(id);
  if (todo) {
    todo.done = !todo.done;
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  }
});

regEvent(EVENT_IDS.DELETE_TODO, ({ draftDb }, id: TodoId) => {
  draftDb.todos.delete(id);
  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

regEvent(EVENT_IDS.SAVE, ({ draftDb }, id: TodoId, newTitle: string) => {
  const todo = draftDb.todos.get(id);
  if (todo) {
    todo.title = newTitle.trim() + 'event2';
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  }
});

regEvent(EVENT_IDS.COMPLETE_ALL_TOGGLE, ({ draftDb }) => {
  const todosArray = Array.from((draftDb.todos as Todos).values()) as Todo[];
  const allComplete = todosArray.length > 0 && todosArray.every((todo) => todo.done);

  todosArray.forEach((todo) => {
    todo.done = !allComplete;
  });

  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

regEvent(EVENT_IDS.CLEAR_COMPLETED, ({ draftDb }) => {
  const todosArray = Array.from((draftDb.todos as Todos).entries()) as [TodoId, Todo][];
  todosArray.forEach(([id, todo]) => {
    if (todo.done) {
      draftDb.todos.delete(id);
    }
  });

  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

regEvent(EVENT_IDS.SET_SHOWING, ({ draftDb }, showing: Showing) => {
  draftDb.showing = showing;
});

if (import.meta.hot) {
  // Registrations run at module load, so remove them before Vite evaluates a replacement.
  import.meta.hot.dispose(() => {
    clearHandlers('event');
  });

  import.meta.hot.accept((newModule) => {
    if (newModule) {
      console.log('updated: new events module');
    }
  });
}
