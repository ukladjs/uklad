/**
 * Subscription IDs module - centralized, typesafe subscription identifiers
 * All subscription IDs are defined here as constants for better maintainability and type safety
 */

// Subscription ID constants
export const SUB_IDS = {
  // Root subscriptions (directly from app state)
  TODOS: 'todos',
  SHOWING: 'showing',

  // Computed subscriptions (derived from other subscriptions)
  VISIBLE_TODOS: 'visible-todos',
  ALL_COMPLETE: 'all-complete?',
  FOOTER_COUNTS: 'footer-counts',
} as const;

// Type for all valid subscription IDs
export type SubscriptionId = (typeof SUB_IDS)[keyof typeof SUB_IDS];

// Helper type to ensure subscription ID is valid
export const isValidSubscriptionId = (id: string): id is SubscriptionId => {
  return Object.values(SUB_IDS).includes(id as SubscriptionId);
};
