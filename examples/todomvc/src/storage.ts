import { regCoeffect, regEffect, type CoEffects } from '@lib/index';

import { COEFFECT_IDS } from './coeffect-ids';
import type { Todo, TodoId, Todos } from './db';
import { EFFECT_IDS } from './effect-ids';

const LOCAL_STORAGE_KEY = 'todos-reflex';

export function todosToLocalStore(todos: Todos): void {
  // JSON does not preserve Map entries, so persist an entry tuple array.
  const todosArray = Array.from(todos.entries());
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(todosArray));
}

export function todosFromLocalStore(): Todos {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) {
      return new Map();
    }

    // This example owns the storage key, so it omits schema validation.
    const todosArray: [TodoId, Todo][] = JSON.parse(stored);
    return new Map(todosArray);
  } catch (error) {
    console.warn('Failed to load todos from localStorage:', error);
    return new Map();
  }
}

regCoeffect(COEFFECT_IDS.LOCAL_STORE_TODOS, (cofx: CoEffects) => {
  cofx.localStoreTodos = todosFromLocalStore();
  return cofx;
});

regEffect(EFFECT_IDS.TODOS_TO_LOCAL_STORE, (todos) => {
  todosToLocalStore(todos);
});
