export const EFFECT_IDS = {
  TODOS_TO_LOCAL_STORE: 'todos-to-local-store',
} as const;

export type EffectId = (typeof EFFECT_IDS)[keyof typeof EFFECT_IDS];

export const isValidEffectId = (id: string): id is EffectId =>
  Object.values(EFFECT_IDS).includes(id as EffectId);
