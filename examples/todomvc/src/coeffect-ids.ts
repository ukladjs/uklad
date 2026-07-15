/**
 * Coeffect IDs module - centralized, typesafe coeffect identifiers
 * All coeffect IDs are defined here as constants for better maintainability and type safety
 */

// Coeffect ID constants
export const COEFFECT_IDS = {
  // Custom coeffects (defined in this app)
  LOCAL_STORE_TODOS: 'local-store-todos',

  // Built-in coeffects (from reflex core)
  NOW: 'now',
  RANDOM: 'random',
} as const;

// Type for all valid coeffect IDs
export type CoeffectId = (typeof COEFFECT_IDS)[keyof typeof COEFFECT_IDS];

// Helper type to ensure coeffect ID is valid
export const isValidCoeffectId = (id: string): id is CoeffectId => {
  return Object.values(COEFFECT_IDS).includes(id as CoeffectId);
};
