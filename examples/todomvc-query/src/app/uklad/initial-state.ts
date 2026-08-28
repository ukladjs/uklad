import type { AppState } from './contracts';
import { createTodosShowing } from '../../features/todos/state';

export function createAppState(): AppState {
  return { todosShowing: createTodosShowing() };
}
