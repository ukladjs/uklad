import type { UkladContracts } from '@ukladjs/core/vanilla';

import type { Todo, TodoId, TodosQueryResult, TodosShowing } from '../../features/todos/state';
import type { appIds, stateKeys } from './catalog';

export interface AppState {
  [stateKeys.todosShowing]: TodosShowing;
}

/**
 * `todos/query` is an ordinary external subscription over this clean remote
 * read model. TanStack lifecycle/cache state stays inside the query adapter.
 */
export interface AppContracts extends UkladContracts {
  state: AppState;

  coeffects: {
    [appIds.coeffects.todosCachedList]: {
      arg: void;
      value: readonly Todo[] | undefined;
    };
  };

  events: {
    [appIds.events.todosAdd]: [title: string];
    [appIds.events.todosToggleDone]: [id: TodoId, done: boolean];
    [appIds.events.todosDelete]: [id: TodoId];
    [appIds.events.todosSave]: [id: TodoId, title: string];
    [appIds.events.todosCompleteAll]: [done: boolean];
    [appIds.events.todosClearCompleted]: [];
    [appIds.events.todosSetShowing]: [showing: TodosShowing];
    [appIds.events.todosRefresh]: [];
  };

  effects: {
    [appIds.effects.todosCreate]: { readonly title: string };
    [appIds.effects.todosUpdate]: {
      readonly id: TodoId;
      readonly title?: string;
      readonly done?: boolean;
    };
    [appIds.effects.todosDelete]: TodoId;
    [appIds.effects.todosCompleteAll]: { readonly done: boolean };
    [appIds.effects.todosClearCompleted]: void;
    [appIds.effects.todosRefresh]: void;
  };

  subscriptions: {
    [appIds.subscriptions.todosQuery]: {
      params: [];
      result: TodosQueryResult;
    };
    [appIds.subscriptions.todosVisible]: { params: []; result: Todo[] };
    [appIds.subscriptions.todosAllComplete]: { params: []; result: boolean };
    [appIds.subscriptions.todosFooterCounts]: {
      params: [];
      result: [active: number, done: number];
    };
    [appIds.subscriptions.todosShowing]: { params: []; result: TodosShowing };
  };
}
