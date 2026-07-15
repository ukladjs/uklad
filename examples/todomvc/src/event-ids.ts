export const EVENT_IDS = {
  INIT_APP: 'init-app',
  ADD_TODO: 'add-todo',
  TOGGLE_DONE: 'toggle-done',
  DELETE_TODO: 'delete-todo',
  SAVE: 'save',
  COMPLETE_ALL_TOGGLE: 'complete-all-toggle',
  CLEAR_COMPLETED: 'clear-completed',
  SET_SHOWING: 'set-showing',
} as const;

export type EventId = (typeof EVENT_IDS)[keyof typeof EVENT_IDS];

export const isValidEventId = (id: string): id is EventId =>
  Object.values(EVENT_IDS).includes(id as EventId);
