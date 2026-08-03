import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerCounterEvents } from './events';
import { registerCounterSubscriptions } from './subscriptions';

export const counterModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerCounterEvents(registrar);
  registerCounterSubscriptions(registrar);
};
