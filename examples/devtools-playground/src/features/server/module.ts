import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerServerEvents } from './events';
import { registerServerSubscriptions } from './subscriptions';

export const serverModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerServerEvents(registrar);
  registerServerSubscriptions(registrar);
};
