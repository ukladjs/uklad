/** The small catalog for the query-owned TodoMVC example. */
export const stateKeys = {
  todosShowing: 'todosShowing',
  todosQuery: 'todosQuery',
} as const;

/**
 * TanStack owns the remote collection. Uklad owns local UI state, commands,
 * and subscriptions which compose the two.
 */
export const appIds = {
  events: {
    todosAdd: 'todos/add',
    todosToggleDone: 'todos/toggle-done',
    todosDelete: 'todos/delete',
    todosSave: 'todos/save',
    todosCompleteAll: 'todos/complete-all',
    todosClearCompleted: 'todos/clear-completed',
    todosSetShowing: 'todos/set-showing',
    todosRefresh: 'todos/refresh',
  },
  effects: {
    todosCreate: 'todos-api/create',
    todosUpdate: 'todos-api/update',
    todosDelete: 'todos-api/delete',
    todosCompleteAll: 'todos-api/complete-all',
    todosClearCompleted: 'todos-api/clear-completed',
    todosRefresh: 'todos-api/refresh',
  },
  subscriptions: {
    todosQuery: 'todos/query',
    todosVisible: 'todos/visible',
    todosAllComplete: 'todos/all-complete',
    todosFooterCounts: 'todos/footer-counts',
    todosShowing: 'todos/showing',
  },
} as const;
