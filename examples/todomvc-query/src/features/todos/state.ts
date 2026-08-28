/** Domain types and local initial values for the todos feature. */
export type TodoId = number;

export interface Todo {
  readonly id: TodoId;
  readonly title: string;
  readonly done: boolean;
}

/** The clean remote read model exposed through the todos/query subscription. */
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

export function createTodosShowing(): TodosShowing {
  return 'all';
}
