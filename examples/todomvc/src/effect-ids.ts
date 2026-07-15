/**
 * Effect IDs module - centralized, typesafe effect identifiers
 * All effect IDs are defined here as constants for better maintainability and type safety
 */

// Effect ID constants
export const EFFECT_IDS = {
  // Custom effects (defined in this app)
  TODOS_TO_LOCAL_STORE: 'todos-to-local-store',
} as const;

// Type for all valid effect IDs
export type EffectId = (typeof EFFECT_IDS)[keyof typeof EFFECT_IDS];

// Helper type to ensure effect ID is valid
export const isValidEffectId = (id: string): id is EffectId => {
  return Object.values(EFFECT_IDS).includes(id as EffectId);
};
