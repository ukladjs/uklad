/**
 * Domain types and initial values for the roots the `todos` feature owns.
 *
 * There is no nested `TodosState` container: `todosById` and `todosShowing`
 * change independently and are observed independently, so each is its own
 * top-level application root. Reflex compares roots by identity when deciding
 * what to publish, so editing a todo must not invalidate the filter.
 */

export type TodoId = number;

export interface Todo {
  id: TodoId;
  title: string;
  done: boolean;
}

/** Reactive root `todosById`: every todo, keyed by id. */
export type TodosById = Map<TodoId, Todo>;

/** Reactive root `todosShowing`: which todos the list displays. */
export type TodosShowing = 'all' | 'active' | 'done';

export function createTodosById(): TodosById {
  return new Map<TodoId, Todo>();
}

export function createTodosShowing(): TodosShowing {
  return 'all';
}
