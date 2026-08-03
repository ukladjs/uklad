import { createTodosById, createTodosShowing } from '../../features/todos/state';
import { stateKeys } from './catalog';
import type { AppState } from './contracts';

/**
 * Compose the feature-owned initial root values into one application state.
 *
 * A fresh object per call: every execution owner (the browser app, a test, a
 * headless run) gets its own state rather than sharing a module-level literal.
 */
export function createAppState(): AppState {
  return {
    [stateKeys.todosById]: createTodosById(),
    [stateKeys.todosShowing]: createTodosShowing(),
  };
}
