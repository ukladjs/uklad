export const COEFFECT_IDS = {
  LOCAL_STORE_TODOS: 'local-store-todos',

  NOW: 'now',
  RANDOM: 'random',
} as const;

export type CoeffectId = (typeof COEFFECT_IDS)[keyof typeof COEFFECT_IDS];

export const isValidCoeffectId = (id: string): id is CoeffectId =>
  Object.values(COEFFECT_IDS).includes(id as CoeffectId);
