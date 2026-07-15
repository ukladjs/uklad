import { regCoeffect, regEffect } from '@lib/index';
import type { CoEffects } from '@lib/types';
import type { Todo, TodoId, Todos } from './db';
import { COEFFECT_IDS } from './coeffect-ids';
import { EFFECT_IDS } from './effect-ids';

// -- Local Storage  ----------------------------------------------------------
const LS_KEY = 'todos-reflex';

export function todosToLocalStore(todos: Todos): void {
  // Convert Map to array of [key, value] pairs for JSON serialization
  const todosArray = Array.from(todos.entries());
  localStorage.setItem(LS_KEY, JSON.stringify(todosArray));
}

export function todosFromLocalStore(): Todos {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) {
      return new Map();
    }

    // Parse JSON and convert back to Map
    const todosArray: [TodoId, Todo][] = JSON.parse(stored);
    return new Map(todosArray);
  } catch (error) {
    console.warn('Failed to load todos from localStorage:', error);
    return new Map();
  }
}

// -- Coeffects ---------------------------------------------------

// This function provides the todos stored in localStorage as a coeffect.
regCoeffect(COEFFECT_IDS.LOCAL_STORE_TODOS, (cofx: CoEffects) => {
  cofx.localStoreTodos = todosFromLocalStore();
  return cofx;
});

// -- Effects -----------------------------------------------------------------

// This function saves the todos to localStorage when the todos are updated.
regEffect(EFFECT_IDS.TODOS_TO_LOCAL_STORE, (todos) => {
  todosToLocalStore(todos);
});
