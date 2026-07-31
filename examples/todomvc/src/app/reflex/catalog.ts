/**
 * The application catalog: the single place where this app's state roots and
 * runtime handler ids are declared.
 *
 * `stateKeys` and `appIds` are deliberately separate. A state key is a
 * structural property of the application state object — event handlers reach it
 * as `draftState.todosById`. A handler id is a runtime name that registrations,
 * dispatches, and subscription queries address. `regRootSub` is the one place
 * the two meet, and it maps them explicitly.
 *
 * Every value is a direct string literal so that a text search, a partial file
 * read, or a static analysis pass finds the same answer the runtime does.
 */

/** Top-level application state properties. Each one is an independent reactive root. */
export const stateKeys = {
  todosById: 'todosById',
  todosShowing: 'todosShowing',
} as const;

/**
 * Application-defined runtime handler ids, grouped by kind.
 *
 * There is no `effects` group: TodoMVC's own event handlers return no effects.
 * Persistence is a module that owns and emits its own ids (see
 * `platform/web/persistence.ts`), and `dispatch`/`dispatch-later` are
 * runtime-reserved built-ins that never belong here.
 */
export const appIds = {
  events: {
    todosAdd: 'todos/add',
    todosToggleDone: 'todos/toggle-done',
    todosDelete: 'todos/delete',
    todosSave: 'todos/save',
    todosCompleteAllToggle: 'todos/complete-all-toggle',
    todosClearCompleted: 'todos/clear-completed',
    todosSetShowing: 'todos/set-showing',
  },
  subscriptions: {
    todosById: 'todos/by-id',
    todosShowing: 'todos/showing',
    todosVisible: 'todos/visible',
    todosAllComplete: 'todos/all-complete',
    todosFooterCounts: 'todos/footer-counts',
  },
  coeffects: {
    systemNow: 'system/now',
  },
} as const;
