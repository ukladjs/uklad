import type { AppState } from './contracts';
import { createTodosQuery, createTodosShowing } from '../../features/todos/state';

export function createAppState(): AppState {
  return { todosShowing: createTodosShowing(), todosQuery: createTodosQuery() };
}
