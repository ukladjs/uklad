import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';

import type { Showing, Todo, TodoId, Todos, TodoState } from './state';
import type { EVENT_IDS } from './event-ids';
import type { SUB_IDS } from './sub-ids';

/**
 * The store-local type contract for this application's runtime.
 *
 * Declaring it is what makes `dispatch`, `regEvent`, `regSub`, and
 * `useSubscription` check ids, parameters, and results against one source of
 * truth. The keys are the `EVENT_IDS`/`SUB_IDS` constants themselves, so an id
 * cannot drift between its declaration, its registration, and its call sites.
 *
 * `effects` is deliberately absent: TodoMVC's own event handlers return no
 * effects, and the persistence module registers and emits its own. Leaving the
 * section out keeps those permissive instead of asserting a list this app does
 * not own.
 */
export interface TodoContracts extends ReflexContracts {
  state: TodoState;

  events: {
    [EVENT_IDS.ADD_TODO]: [title: string];
    [EVENT_IDS.TOGGLE_DONE]: [id: TodoId];
    [EVENT_IDS.DELETE_TODO]: [id: TodoId];
    [EVENT_IDS.SAVE]: [id: TodoId, newTitle: string];
    [EVENT_IDS.COMPLETE_ALL_TOGGLE]: [];
    [EVENT_IDS.CLEAR_COMPLETED]: [];
    [EVENT_IDS.SET_SHOWING]: [showing: Showing];
  };

  subscriptions: {
    [SUB_IDS.TODOS]: { params: []; result: Todos };
    [SUB_IDS.SHOWING]: { params: []; result: Showing };
    [SUB_IDS.VISIBLE_TODOS]: { params: []; result: Todo[] };
    [SUB_IDS.ALL_COMPLETE]: { params: []; result: boolean };
    [SUB_IDS.FOOTER_COUNTS]: { params: []; result: [active: number, done: number] };
  };
}
