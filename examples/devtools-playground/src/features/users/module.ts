import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerUsersEvents } from './events';
import { registerUsersSubscriptions } from './subscriptions';

export const usersModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerUsersEvents(registrar);
  registerUsersSubscriptions(registrar);
};
