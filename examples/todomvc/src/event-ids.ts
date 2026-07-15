/**
 * Event IDs module - centralized, typesafe event identifiers
 * All event IDs are defined here as constants for better maintainability and type safety
 */

// Event ID constants
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

// Type for all valid event IDs
export type EventId = (typeof EVENT_IDS)[keyof typeof EVENT_IDS];

// Helper type to ensure event ID is valid
export const isValidEventId = (id: string): id is EventId => {
  return Object.values(EVENT_IDS).includes(id as EventId);
};
