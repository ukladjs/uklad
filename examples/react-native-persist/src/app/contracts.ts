import type { UkladContracts } from '@ukladjs/core/vanilla';

import type { eventIds, stateKeys, subscriptionIds } from './catalog';

export interface AppContracts extends UkladContracts {
  readonly state: { [stateKeys.count]: number };
  readonly events: { [eventIds.increment]: [] };
  readonly subscriptions: {
    [subscriptionIds.count]: { params: []; result: number };
  };
}
