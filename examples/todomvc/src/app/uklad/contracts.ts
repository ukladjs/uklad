import type { UkladContracts } from '@ukladjs/core/vanilla';

import type { Todo, TodoId, TodosById, TodosShowing } from '../../features/todos/state';
import type { appIds, stateKeys } from './catalog';

/**
 * The application state shape: one object whose top-level keys are the
 * reactive roots declared in `stateKeys`.
 */
export interface AppState {
  [stateKeys.todosById]: TodosById;
  [stateKeys.todosShowing]: TodosShowing;
}

/**
 * The complete type contract for this application's runtime.
 *
 * The catalog answers *which* names exist; this answers *what they mean*.
 * Every key below is a catalog value used as a computed key, so an id cannot
 * drift between its declaration, its registration, and its call sites.
 *
 * Declaring the contract is what makes `dispatch`, `regEvent`, `regSub`, and
 * `useSubscription` check ids, parameters, and results against one source of
 * truth. It describes the whole application rather than one feature: feature
 * modules are typed against `UkladRegistrar<AppContracts>` and may freely
 * depend on another feature's ids.
 *
 * `effects` is deliberately absent — TodoMVC's own event handlers return no
 * effects, and the persistence module registers and emits its own. Leaving the
 * section out keeps those permissive instead of asserting a list this app does
 * not own.
 */
export interface AppContracts extends UkladContracts {
  state: AppState;

  /** One entry per provider id: what it is injected with, and what it contributes. */
  coeffects: {
    [appIds.coeffects.systemNow]: { arg: void; value: number };
  };

  events: {
    [appIds.events.todosAdd]: [title: string];
    [appIds.events.todosToggleDone]: [id: TodoId];
    [appIds.events.todosDelete]: [id: TodoId];
    [appIds.events.todosSave]: [id: TodoId, newTitle: string];
    [appIds.events.todosCompleteAllToggle]: [];
    [appIds.events.todosClearCompleted]: [];
    [appIds.events.todosSetShowing]: [showing: TodosShowing];
  };

  subscriptions: {
    // Root subscriptions declare no parameters and a result matching the
    // backing state root they are mapped to by `regRootSub`.
    [appIds.subscriptions.todosById]: { params: []; result: TodosById };
    [appIds.subscriptions.todosShowing]: { params: []; result: TodosShowing };

    [appIds.subscriptions.todosVisible]: { params: []; result: Todo[] };
    [appIds.subscriptions.todosAllComplete]: { params: []; result: boolean };
    [appIds.subscriptions.todosFooterCounts]: {
      params: [];
      result: [active: number, done: number];
    };
  };
}
