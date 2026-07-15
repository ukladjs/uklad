export const SUB_IDS = {
  TODOS: 'todos',
  SHOWING: 'showing',

  VISIBLE_TODOS: 'visible-todos',
  ALL_COMPLETE: 'all-complete?',
  FOOTER_COUNTS: 'footer-counts',
} as const;

export type SubscriptionId = (typeof SUB_IDS)[keyof typeof SUB_IDS];

export const isValidSubscriptionId = (id: string): id is SubscriptionId =>
  Object.values(SUB_IDS).includes(id as SubscriptionId);
