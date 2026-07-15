import { regEvent, clearHandlers } from '@lib/index';
import type { Todo, TodoId, Todos, Showing } from './db';
import { current } from 'immer';
import { EVENT_IDS } from './event-ids';
import { COEFFECT_IDS } from './coeffect-ids';
import { EFFECT_IDS } from './effect-ids';

// Event to initialize the app, load todos from localStorage with coeffect
regEvent(
  EVENT_IDS.INIT_APP,
  ({ draftDb, localStoreTodos }) => {
    if (localStoreTodos && localStoreTodos.size > 0) {
      draftDb.todos = localStoreTodos;
    }
  },
  [[COEFFECT_IDS.LOCAL_STORE_TODOS]],
);

// Event to add a new todo
regEvent(
  EVENT_IDS.ADD_TODO,
  ({ draftDb, now }, title: string) => {
    const newTodo: Todo = {
      id: now, // Simple ID generation
      title: title.trim(),
      done: false,
    };

    draftDb.todos.set(newTodo.id, newTodo);
    // Save to localStorage
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  },
  [[COEFFECT_IDS.NOW]],
);

// Event to toggle todo completion
regEvent(EVENT_IDS.TOGGLE_DONE, ({ draftDb }, id: TodoId) => {
  const todo = draftDb.todos.get(id);
  if (todo) {
    todo.done = !todo.done;
    // Save to localStorage
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  }
});

// Event to delete a todo
regEvent(EVENT_IDS.DELETE_TODO, ({ draftDb }, id: TodoId) => {
  draftDb.todos.delete(id);
  // Save to localStorage
  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

// Event to save/edit a todo
regEvent(EVENT_IDS.SAVE, ({ draftDb }, id: TodoId, newTitle: string) => {
  const todo = draftDb.todos.get(id);
  if (todo) {
    todo.title = newTitle.trim() + 'event2';
    // Save to localStorage
    return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
  }
});

// Event to toggle all todos completion
regEvent(EVENT_IDS.COMPLETE_ALL_TOGGLE, ({ draftDb }) => {
  const todosArray = Array.from((draftDb.todos as Todos).values()) as Todo[];
  const allComplete = todosArray.length > 0 && todosArray.every((todo) => todo.done);

  todosArray.forEach((todo) => {
    todo.done = !allComplete;
  });

  // Save to localStorage
  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

// Event to clear completed todos
regEvent(EVENT_IDS.CLEAR_COMPLETED, ({ draftDb }) => {
  const todosArray = Array.from((draftDb.todos as Todos).entries()) as [TodoId, Todo][];
  todosArray.forEach(([id, todo]) => {
    if (todo.done) {
      draftDb.todos.delete(id);
    }
  });

  // Save to localStorage
  return [[EFFECT_IDS.TODOS_TO_LOCAL_STORE, current(draftDb.todos)]];
});

// Event to set showing filter
regEvent(EVENT_IDS.SET_SHOWING, ({ draftDb }, showing: Showing) => {
  draftDb.showing = showing;
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearHandlers('event');
  });

  import.meta.hot.accept((newModule) => {
    if (newModule) {
      console.log('updated: new events module');
    }
  });
}
