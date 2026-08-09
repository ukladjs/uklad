/** Domain types and initial values for the roots owned by the todos feature. */
export type TodoId = number;

export interface Todo {
  readonly id: TodoId;
  readonly title: string;
  readonly done: boolean;
}

/** The clean remote read model exposed through the todos/query root. */
export type TodosQueryResult =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly todos: readonly Todo[] }
  | { readonly kind: 'error'; readonly message: string };

/** Local UI state, not part of the remote Todo query key. */
export type TodosShowing = 'all' | 'active' | 'done';

export interface UpdateTodoRequest {
  readonly title?: string;
  readonly done?: boolean;
}

const INITIAL_TODOS_QUERY: TodosQueryResult = Object.freeze({ kind: 'loading' });

export function createTodosShowing(): TodosShowing {
  return 'all';
}

export function createTodosQuery(): TodosQueryResult {
  return INITIAL_TODOS_QUERY;
}
